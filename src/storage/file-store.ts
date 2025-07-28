import { createLogger } from "../utils/logger.js";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

const logger = createLogger("FileStore");

export interface FileStoreConfig {
  path: string;
  maxSize?: string;
}

export class FileStore {
  private initialized = false;
  private path: string;
  private maxSize: number;

  constructor(config: FileStoreConfig) {
    this.path = config.path;
    this.maxSize = this.parseSize(config.maxSize || '10MB');
  }

  async initialize(): Promise<void> {
    logger.info("Initializing file store...");
    
    // Create directory structure
    await fs.mkdir(this.path, { recursive: true });
    await fs.mkdir(path.join(this.path, 'content'), { recursive: true });
    await fs.mkdir(path.join(this.path, 'metadata'), { recursive: true });
    
    this.initialized = true;
    logger.info("File store initialized");
  }

  async store(id: string, content: string): Promise<string> {
    if (!this.initialized) {
      throw new Error("File store not initialized");
    }

    const size = Buffer.byteLength(content, 'utf-8');
    if (size > this.maxSize) {
      throw new Error(`Content size ${size} exceeds max size ${this.maxSize}`);
    }

    // Use first two characters of ID for sharding
    const shard = id.substring(0, 2);
    const contentDir = path.join(this.path, 'content', shard);
    await fs.mkdir(contentDir, { recursive: true });
    
    const contentPath = path.join(contentDir, `${id}.txt`);
    const metadataPath = path.join(this.path, 'metadata', `${id}.json`);
    
    // Calculate checksum
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    
    // Store content
    await fs.writeFile(contentPath, content, 'utf-8');
    
    // Store metadata
    const metadata = {
      id,
      size,
      checksum,
      storedAt: new Date().toISOString()
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    
    logger.debug(`Stored file ${id} (${size} bytes)`);
    return checksum;
  }

  async retrieve(id: string): Promise<string | null> {
    if (!this.initialized) {
      throw new Error("File store not initialized");
    }

    const shard = id.substring(0, 2);
    const contentPath = path.join(this.path, 'content', shard, `${id}.txt`);
    
    try {
      const content = await fs.readFile(contentPath, 'utf-8');
      
      // Verify checksum if metadata exists
      const metadataPath = path.join(this.path, 'metadata', `${id}.json`);
      try {
        const metadataStr = await fs.readFile(metadataPath, 'utf-8');
        const metadata = JSON.parse(metadataStr) as { checksum: string };
        const checksum = crypto.createHash('sha256').update(content).digest('hex');
        
        if (checksum !== metadata.checksum) {
          logger.error(`Checksum mismatch for file ${id}`);
          throw new Error(`File integrity check failed for ${id}`);
        }
      } catch (error) {
        // Re-throw integrity errors
        if (error instanceof Error && error.message?.includes('File integrity check failed')) {
          throw error;
        }
        // Metadata file might not exist for older entries
        logger.debug(`No metadata found for file ${id}`);
      }
      
      return content;
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("File store not initialized");
    }

    const shard = id.substring(0, 2);
    const contentPath = path.join(this.path, 'content', shard, `${id}.txt`);
    const metadataPath = path.join(this.path, 'metadata', `${id}.json`);
    
    let deleted = false;
    
    try {
      await fs.unlink(contentPath);
      deleted = true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    try {
      await fs.unlink(metadataPath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    return deleted;
  }

  async exists(id: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("File store not initialized");
    }

    const shard = id.substring(0, 2);
    const contentPath = path.join(this.path, 'content', shard, `${id}.txt`);
    
    try {
      await fs.access(contentPath);
      return true;
    } catch {
      return false;
    }
  }

  async getStats(): Promise<{ count: number; totalSize: number }> {
    if (!this.initialized) {
      throw new Error("File store not initialized");
    }

    let count = 0;
    let totalSize = 0;
    
    const contentDir = path.join(this.path, 'content');
    const shards = await fs.readdir(contentDir);
    
    for (const shard of shards) {
      const shardPath = path.join(contentDir, shard);
      const files = await fs.readdir(shardPath);
      
      for (const file of files) {
        if (file.endsWith('.txt')) {
          count++;
          const filePath = path.join(shardPath, file);
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
        }
      }
    }
    
    return { count, totalSize };
  }

  close(): void {
    this.initialized = false;
    logger.info("File store closed");
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