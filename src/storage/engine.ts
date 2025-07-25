import { createLogger } from "../utils/logger.js";
import type { Config } from "../config/index.js";
import { SQLiteDatabase, Memory as SQLiteMemory } from "./sqlite.js";

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
    
    // TODO: Initialize vector storage
    // TODO: Initialize file storage
    
    this.initialized = true;
    logger.info("Storage engine initialized");
  }

  async captureMemory(memory: Omit<Memory, "id">): Promise<Memory> {
    if (!this.initialized || !this.sqlite) {
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
    
    // TODO: Generate embeddings
    // TODO: Store in vector database
    
    return storedMemory;
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

  async close(): Promise<void> {
    logger.info("Closing storage engine...");
    
    // Close database connections
    if (this.sqlite) {
      await this.sqlite.close();
      this.sqlite = null;
    }
    
    // TODO: Close vector store
    // TODO: Close file store
    
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