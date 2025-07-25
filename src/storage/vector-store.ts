import { createLogger } from "../utils/logger.js";
import path from "path";
import fs from "fs/promises";

const logger = createLogger("VectorStore");

export interface VectorConfig {
  dimension: number;
  path?: string;
  provider?: 'chromadb' | 'local';
}

export interface VectorSearchOptions {
  k: number;
  filter?: Record<string, any>;
  threshold?: number;
}

export interface VectorResult {
  id: string;
  vector: number[];
  metadata: Record<string, any>;
  score: number;
}

export class VectorStore {
  private initialized = false;
  private dimension: number;
  private path?: string;
  private vectors: Map<string, { vector: number[]; metadata: Record<string, any> }> = new Map();
  private indexFile?: string;

  constructor(config: VectorConfig) {
    this.dimension = config.dimension;
    this.path = config.path;
    if (this.path) {
      this.indexFile = path.join(this.path, 'vectors.json');
    }
  }

  async initialize(): Promise<void> {
    logger.info("Initializing vector store...");
    
    // Create directory if needed
    if (this.path) {
      await fs.mkdir(this.path, { recursive: true });
      
      // Load existing vectors if available
      try {
        const data = await fs.readFile(this.indexFile!, 'utf-8');
        const parsed = JSON.parse(data);
        this.vectors = new Map(Object.entries(parsed));
        logger.info(`Loaded ${this.vectors.size} vectors from disk`);
      } catch (error) {
        // File doesn't exist yet, which is fine
        logger.debug("No existing vector index found");
      }
    }
    
    this.initialized = true;
    logger.info("Vector store initialized");
  }

  async store(vector: number[], metadata: Record<string, any> = {}): Promise<string> {
    if (!this.initialized) {
      throw new Error("Vector store not initialized");
    }

    if (vector.length !== this.dimension) {
      throw new Error(`Vector dimension mismatch. Expected ${this.dimension}, got ${vector.length}`);
    }

    // Generate ID
    const id = `vec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store vector
    this.vectors.set(id, { vector, metadata });
    
    // Persist if configured
    if (this.path) {
      await this.persist();
    }
    
    logger.debug(`Stored vector ${id}`);
    return id;
  }

  async get(id: string): Promise<VectorResult | null> {
    if (!this.initialized) {
      throw new Error("Vector store not initialized");
    }

    const data = this.vectors.get(id);
    if (!data) {
      return null;
    }

    return {
      id,
      vector: data.vector,
      metadata: data.metadata,
      score: 1.0 // Perfect match
    };
  }

  async search(queryVector: number[], options: VectorSearchOptions): Promise<VectorResult[]> {
    if (!this.initialized) {
      throw new Error("Vector store not initialized");
    }

    if (queryVector.length !== this.dimension) {
      throw new Error(`Query vector dimension mismatch. Expected ${this.dimension}, got ${queryVector.length}`);
    }

    // Calculate similarities
    const results: VectorResult[] = [];
    
    for (const [id, data] of this.vectors.entries()) {
      // Apply metadata filter if provided
      if (options.filter) {
        const matches = Object.entries(options.filter).every(([key, value]) => {
          return data.metadata[key] === value;
        });
        if (!matches) continue;
      }
      
      // Calculate cosine similarity
      const score = this.cosineSimilarity(queryVector, data.vector);
      
      // Apply threshold if provided
      if (options.threshold && score < options.threshold) {
        continue;
      }
      
      results.push({
        id,
        vector: data.vector,
        metadata: data.metadata,
        score
      });
    }
    
    // Sort by score (descending) and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options.k);
  }

  async delete(id: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Vector store not initialized");
    }

    const existed = this.vectors.delete(id);
    
    if (existed && this.path) {
      await this.persist();
    }
    
    return existed;
  }

  async clear(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Vector store not initialized");
    }

    this.vectors.clear();
    
    if (this.path) {
      await this.persist();
    }
  }

  async close(): Promise<void> {
    if (this.initialized && this.path) {
      await this.persist();
    }
    this.initialized = false;
    logger.info("Vector store closed");
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (normA * normB);
  }

  private async persist(): Promise<void> {
    if (!this.indexFile) return;
    
    const data = Object.fromEntries(this.vectors.entries());
    await fs.writeFile(this.indexFile, JSON.stringify(data, null, 2));
    logger.debug(`Persisted ${this.vectors.size} vectors to disk`);
  }
}