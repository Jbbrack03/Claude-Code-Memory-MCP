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
  metadata?: Record<string, any>;
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
    const storedMemory = await this.sqlite.storeMemory(memory as SQLiteMemory);
    
    // Generate embeddings if service is available
    if (this.embeddingService && this.shouldGenerateEmbedding(memory)) {
      try {
        const embedding = await this.embeddingService(memory.content);
        const vectorId = await this.vectorStore.store(embedding, {
          memoryId: storedMemory.id,
          eventType: memory.eventType,
          sessionId: memory.sessionId
        });
        
        // Store vector mapping in SQLite
        await this.sqlite.run(
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
        await this.fileStore.store(storedMemory.id!, memory.content);
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
  } = {}): Promise<Memory[]> {
    if (!this.initialized || !this.sqlite) {
      throw new Error("Storage engine not initialized");
    }

    logger.debug("Querying memories", filters);
    
    // Query from SQLite
    const sqliteMemories = await this.sqlite.queryMemories(filters);
    
    // Convert to ensure all memories have an id
    const memories: Memory[] = sqliteMemories.map(m => ({
      id: m.id!,  // queryMemories only returns stored memories with IDs
      eventType: m.eventType,
      content: m.content,
      metadata: m.metadata,
      timestamp: m.timestamp,
      sessionId: m.sessionId,
      workspaceId: m.workspaceId,
      gitBranch: m.gitBranch,
      gitCommit: m.gitCommit
    }));
    
    // TODO: Apply vector similarity search if needed
    
    return memories;
  }

  async getStatistics(): Promise<StorageStats> {
    if (!this.initialized || !this.sqlite) {
      throw new Error("Storage engine not initialized");
    }

    // Query statistics from database
    const totalMemories = await this.sqlite.count('memories');
    
    // Get memory types
    const memoriesByType: Record<string, number> = {};
    const types = await this.sqlite.all(
      'SELECT event_type, COUNT(*) as count FROM memories GROUP BY event_type'
    );
    for (const type of types) {
      memoriesByType[type.event_type] = type.count;
    }
    
    // Get date range
    const dateRange = await this.sqlite.get(
      'SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM memories'
    );
    
    // Calculate total size (sum of content lengths for now)
    const sizeResult = await this.sqlite.get(
      'SELECT SUM(LENGTH(content)) as total_size FROM memories'
    );
    
    return {
      totalMemories,
      totalSize: sizeResult?.total_size || 0,
      memoriesByType,
      oldestMemory: dateRange?.oldest ? new Date(dateRange.oldest) : undefined,
      newestMemory: dateRange?.newest ? new Date(dateRange.newest) : undefined
    };
  }

  async getVectorStore(): Promise<VectorStore | null> {
    if (!this.initialized || !this.vectorStore) {
      return null;
    }
    return this.vectorStore;
  }

  async close(): Promise<void> {
    logger.info("Closing storage engine...");
    
    // Close database connections
    if (this.sqlite) {
      await this.sqlite.close();
      this.sqlite = null;
    }
    
    // Close vector store
    if (this.vectorStore) {
      await this.vectorStore.close();
      this.vectorStore = null;
    }
    
    // Close file store
    if (this.fileStore) {
      await this.fileStore.close();
      this.fileStore = null;
    }
    
    this.initialized = false;
    logger.info("Storage engine closed");
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
    
    const value = parseInt(match[1]!);
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