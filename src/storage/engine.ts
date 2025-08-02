import { createLogger } from "../utils/logger.js";
import type { Config } from "../config/index.js";
import { SQLiteDatabase, Memory as SQLiteMemory } from "./sqlite.js";
import { VectorStore } from "./vector-store.js";
import { FileStore } from "./file-store.js";

const logger = createLogger("StorageEngine");

export interface Memory {
  id: string;
  eventType: string;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  sessionId: string;
  workspaceId?: string;
  gitBranch?: string;
  gitCommit?: string;
}

export interface StorageStats {
  totalMemories: number;
  totalSize: number;
  oldestMemory?: Date;
  newestMemory?: Date;
  memoriesByType: Record<string, number>;
}

export class StorageEngine {
  private initialized = false;
  private sqlite: SQLiteDatabase | null = null;
  private vectorStore: VectorStore | null = null;
  private fileStore: FileStore | null = null;
  private embeddingService?: (text: string) => Promise<number[]>;

  constructor(private config: Config["storage"]) {
  }

  async initialize(): Promise<void> {
    logger.info("Initializing storage engine...");
    
    // Initialize SQLite database
    this.sqlite = new SQLiteDatabase({
      path: this.config.sqlite.path,
      walMode: this.config.sqlite.walMode,
      busyTimeout: this.config.sqlite.busyTimeout,
      cacheSize: this.config.sqlite.cacheSize
    });
    await this.sqlite.initialize();
    
    // Initialize vector storage
    this.vectorStore = new VectorStore({
      dimension: this.config.vector.dimension,
      path: this.config.vector.path,
      provider: this.config.vector.provider
    });
    await this.vectorStore.initialize();
    
    // Initialize file storage
    this.fileStore = new FileStore({
      path: this.config.files.path,
      maxSize: this.config.files.maxSize
    });
    await this.fileStore.initialize();
    
    this.initialized = true;
    logger.info("Storage engine initialized");
  }

  setEmbeddingService(service: (text: string) => Promise<number[]>): void {
    this.embeddingService = service;
  }

  async captureMemory(memory: Omit<Memory, "id">): Promise<Memory> {
    if (!this.initialized || !this.sqlite || !this.vectorStore || !this.fileStore) {
      throw new Error("Storage engine not initialized");
    }

    logger.debug("Capturing memory", { eventType: memory.eventType });
    
    // Validate memory
    this.validateMemory(memory);
    
    // Check size limits
    const size = this.calculateMemorySize(memory);
    if (size > this.parseSize(this.config.limits.maxMemorySize)) {
      throw new MemorySizeError(`Memory size ${size} exceeds limit`);
    }
    
    // Store in SQLite
    const storedMemory = this.sqlite.storeMemory(memory as SQLiteMemory);
    
    // Generate embeddings if service is available
    if (this.embeddingService && this.shouldGenerateEmbedding(memory)) {
      try {
        const embedding = await this.embeddingService(memory.content);
        // Ensure consistent metadata format
        const metadata: Record<string, string> = {
          memoryId: storedMemory.id,
          id: storedMemory.id, // Include both for compatibility
          eventType: memory.eventType,
          sessionId: memory.sessionId,
          content: memory.content.substring(0, 200) // Include truncated content for context
        };
        if (memory.workspaceId !== undefined) {
          metadata.workspaceId = memory.workspaceId;
        }
        if (memory.gitBranch !== undefined) {
          metadata.gitBranch = memory.gitBranch;
        }
        const vectorId = await this.vectorStore.store(embedding, metadata);
        
        // Store vector mapping in SQLite
        this.sqlite.run(
          'INSERT INTO vector_mappings (memory_id, vector_id, model) VALUES (?, ?, ?)',
          [storedMemory.id, vectorId, 'default']
        );
        
        logger.debug(`Stored embedding for memory ${storedMemory.id}`);
      } catch (error) {
        logger.error("Failed to generate/store embedding", error);
        // Continue without embedding - it's not critical
      }
    }
    
    // Store large content in file system if needed
    const FILE_THRESHOLD = 10 * 1024; // 10KB
    if (size > FILE_THRESHOLD) {
      try {
        if (!storedMemory.id) {
          throw new Error('Memory ID is required for file storage');
        }
        await this.fileStore.store(storedMemory.id, memory.content);
        logger.debug(`Stored large content for memory ${storedMemory.id} in file store`);
      } catch (error) {
        logger.error("Failed to store in file system", error);
        // Continue - SQLite already has the content
      }
    }
    
    return storedMemory;
  }

  async queryMemories(filters: {
    workspaceId?: string;
    sessionId?: string;
    eventType?: string;
    gitBranch?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    orderBy?: string;
    orderDirection?: 'ASC' | 'DESC';
    semanticQuery?: string;
  } = {}): Promise<Memory[]> {
    if (!this.initialized || !this.sqlite) {
      throw new Error("Storage engine not initialized");
    }

    logger.debug("Querying memories", filters);
    
    // If semantic query provided, use vector search
    if (filters.semanticQuery && filters.semanticQuery.trim() !== '' && this.vectorStore && this.embeddingService) {
      try {
        // Generate embedding for query
        const queryEmbedding = await this.embeddingService(filters.semanticQuery);
        
        // Search vector store
        const searchFilter: Record<string, unknown> = {};
        if (filters.workspaceId !== undefined) {
          searchFilter.workspaceId = filters.workspaceId;
        }
        if (filters.sessionId !== undefined) {
          searchFilter.sessionId = filters.sessionId;
        }
        if (filters.gitBranch !== undefined) {
          searchFilter.gitBranch = filters.gitBranch;
        }
        
        const vectorResults = await this.vectorStore.search(queryEmbedding, {
          k: filters.limit || 10,
          filter: Object.keys(searchFilter).length > 0 ? searchFilter : undefined
        });
        
        // Get full memories from SQLite - extract memoryId from metadata
        // Handle various metadata formats robustly
        const memoryIds = vectorResults
          .map(r => {
            // Try different possible locations for memory ID
            const metadata = r.metadata || {};
            return metadata.memoryId || 
                   metadata.id || 
                   metadata.memory_id ||
                   (typeof metadata === 'string' ? metadata : null);
          })
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        if (memoryIds.length > 0) {
          const sqliteMemories = this.sqlite.getMemoriesByIds(memoryIds);
          
          // Create a map for quick lookup
          const memoryMap = new Map(sqliteMemories.map(m => [m.id, m]));
          
          // Return memories in the same order as vector results
          const orderedMemories: Memory[] = [];
          for (const memoryId of memoryIds) {
            const memory = memoryMap.get(memoryId);
            if (memory) {
              orderedMemories.push({
                id: memory.id || '',
                eventType: memory.eventType,
                content: memory.content,
                metadata: memory.metadata,
                timestamp: memory.timestamp,
                sessionId: memory.sessionId,
                workspaceId: memory.workspaceId,
                gitBranch: memory.gitBranch,
                gitCommit: memory.gitCommit
              });
            }
          }
          return orderedMemories;
        }
        return [];
      } catch (error) {
        logger.warn("Vector search failed, falling back to SQL", error);
        // Fall through to SQL query
      }
    }
    
    // Query from SQLite
    const sqliteMemories = this.sqlite.queryMemories(filters);
    
    // Convert to ensure all memories have an id
    const memories: Memory[] = sqliteMemories.map(m => ({
      id: m.id || '',  // queryMemories only returns stored memories with IDs
      eventType: m.eventType,
      content: m.content,
      metadata: m.metadata,
      timestamp: m.timestamp,
      sessionId: m.sessionId,
      workspaceId: m.workspaceId,
      gitBranch: m.gitBranch,
      gitCommit: m.gitCommit
    }));
    
    return memories;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatistics(): Promise<StorageStats> {
    if (!this.initialized || !this.sqlite) {
      throw new Error("Storage engine not initialized");
    }

    // Query statistics from database
    const totalMemories = this.sqlite.count('memories');
    
    // Get memory types
    const memoriesByType: Record<string, number> = {};
    const types = this.sqlite.all(
      'SELECT event_type, COUNT(*) as count FROM memories GROUP BY event_type'
    ) as Array<{ event_type: string; count: number }>;
    for (const type of types) {
      const eventType = type.event_type;
      const count = type.count;
      memoriesByType[eventType] = count;
    }
    
    // Get date range
    const dateRange = this.sqlite.get(
      'SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM memories'
    ) as { oldest: string; newest: string } | undefined;
    
    // Calculate total size (sum of content lengths for now)
    const sizeResult = this.sqlite.get(
      'SELECT SUM(LENGTH(content)) as total_size FROM memories'
    ) as { total_size: number } | undefined;
    
    return {
      totalMemories,
      totalSize: sizeResult?.total_size || 0,
      memoriesByType,
      oldestMemory: dateRange?.oldest ? new Date(dateRange.oldest) : undefined,
      newestMemory: dateRange?.newest ? new Date(dateRange.newest) : undefined
    };
  }

  getVectorStore(): VectorStore | null {
    if (!this.initialized || !this.vectorStore) {
      return null;
    }
    return this.vectorStore;
  }

  async close(): Promise<void> {
    logger.info("Closing storage engine...");
    
    // Close database connections
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
    }
    
    // Close vector store
    if (this.vectorStore) {
      await this.vectorStore.close();
      this.vectorStore = null;
    }
    
    // Close file store
    if (this.fileStore) {
      this.fileStore.close();
      this.fileStore = null;
    }
    
    this.initialized = false;
    logger.info("Storage engine closed");
  }

  // Test helper methods (for integration tests)
  async storeTestMemories(memories: Array<Omit<Memory, "id">>): Promise<Memory[]> {
    if (!this.initialized) {
      throw new Error("Storage engine not initialized");
    }

    const stored: Memory[] = [];
    for (const memory of memories) {
      try {
        const result = await this.captureMemory(memory);
        stored.push(result);
      } catch (error) {
        logger.error("Failed to store test memory", error);
        throw error;
      }
    }
    return stored;
  }

  async simulateLargeDataset(count: number): Promise<void> {
    if (!this.initialized) {
      throw new Error("Storage engine not initialized");
    }

    logger.info(`Simulating large dataset with ${count} memories`);
    const batchSize = 100;
    const eventTypes = ['file_write', 'code_write', 'command_run', 'tool_use', 'documentation'];
    
    for (let i = 0; i < count; i += batchSize) {
      const batch: Array<Omit<Memory, "id">> = [];
      const remaining = Math.min(batchSize, count - i);
      
      for (let j = 0; j < remaining; j++) {
        const idx = i + j;
        batch.push({
          eventType: eventTypes[idx % eventTypes.length] ?? 'file_write',
          content: `Test memory ${idx}: ${this.generateTestContent(idx)}`,
          timestamp: new Date(Date.now() - (count - idx) * 60000), // Spread over time
          sessionId: `test-session-${Math.floor(idx / 10)}`,
          workspaceId: `test-workspace-${Math.floor(idx / 100)}`,
          metadata: {
            index: idx,
            batch: Math.floor(i / batchSize),
            isTest: true
          }
        });
      }
      
      await this.storeTestMemories(batch);
      logger.debug(`Stored batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(count / batchSize)}`);
    }
    
    logger.info(`Completed simulating ${count} memories`);
  }

  private generateTestContent(index: number): string {
    const contents = [
      "function calculateSum(a: number, b: number): number { return a + b; }",
      "const result = await fetch('/api/data'); return result.json();",
      "class UserService { constructor(private db: Database) {} }",
      "import React from 'react'; export default function App() { return <div>Hello</div>; }",
      "SELECT * FROM users WHERE active = true ORDER BY created_at DESC;",
      "# Documentation\nThis is a test document with multiple lines\nand various content types."
    ];
    return contents[index % contents.length] || contents[0] || "default content";
  }

  private validateMemory(memory: Omit<Memory, "id">): void {
    if (!memory.eventType) {
      throw new ValidationError('eventType is required');
    }
    if (!memory.content) {
      throw new ValidationError('content is required');
    }
    if (!memory.sessionId) {
      throw new ValidationError('sessionId is required');
    }
    if (memory.timestamp && !(memory.timestamp instanceof Date)) {
      throw new ValidationError('timestamp must be a Date object');
    }
  }

  private calculateMemorySize(memory: Omit<Memory, "id">): number {
    let size = 0;
    size += memory.content.length;
    if (memory.metadata) {
      size += JSON.stringify(memory.metadata).length;
    }
    return size;
  }

  private shouldGenerateEmbedding(memory: Omit<Memory, "id">): boolean {
    // Generate embeddings for content-rich event types
    const embeddableTypes = ['file_write', 'code_write', 'documentation', 'comment'];
    return embeddableTypes.includes(memory.eventType) && memory.content.length > 50;
  }

  private parseSize(sizeStr: string): number {
    const match = sizeStr.match(/^(\d+)([KMG]B)?$/i);
    if (!match) {
      throw new Error(`Invalid size format: ${sizeStr}`);
    }
    
    const firstMatch = match[1];
    if (!firstMatch) {
      throw new Error('Invalid size format');
    }
    const value = parseInt(firstMatch);
    const unit = match[2]?.toUpperCase();
    
    switch (unit) {
      case 'KB':
        return value * 1024;
      case 'MB':
        return value * 1024 * 1024;
      case 'GB':
        return value * 1024 * 1024 * 1024;
      default:
        return value;
    }
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class MemorySizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemorySizeError';
  }
}