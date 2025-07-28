import { createLogger } from "../utils/logger.js";
import type { Config } from "../config/index.js";
import type { StorageEngine } from "../storage/engine.js";
import { EmbeddingGenerator } from "./embeddings.js";
import { ContextBuilder } from "./context-builder.js";
import type { VectorStore } from "../storage/vector-store.js";

const logger = createLogger("IntelligenceLayer");

export interface RetrievalOptions {
  limit?: number;
  filters?: Record<string, unknown>;
  minScore?: number;
  includeMetadata?: boolean;
}

export interface RetrievedMemory {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  eventType?: string;
  sessionId?: string;
  workspaceId?: string;
  gitBranch?: string;
}

export class IntelligenceLayer {
  private config: Config["intelligence"];
  private initialized = false;
  private embeddingService?: (text: string) => Promise<number[]>;
  private storageEngine?: StorageEngine;
  private embeddingGenerator: EmbeddingGenerator;
  private contextBuilder: ContextBuilder;
  private queryCache: Map<string, RetrievedMemory[]> = new Map();
  private vectorStore?: VectorStore;

  constructor(
    config: Config["intelligence"],
    storageEngine?: StorageEngine,
    embeddingGenerator?: EmbeddingGenerator
  ) {
    this.config = config;
    this.storageEngine = storageEngine;
    
    // Create or use provided embedding generator
    this.embeddingGenerator = embeddingGenerator || new EmbeddingGenerator({
      model: config.embeddings.model,
      batchSize: config.embeddings.batchSize,
      cache: config.embeddings.cache
    });

    // Create context builder
    this.contextBuilder = new ContextBuilder({
      maxSize: config.context.maxSize,
      includeMetadata: config.context.includeMetadata,
      deduplicateThreshold: config.context.deduplication ? 0.95 : 1.0
    });
  }

  async initialize(): Promise<void> {
    logger.info("Initializing intelligence layer...");
    
    // Initialize embedding generator
    await this.embeddingGenerator.initialize();
    
    // Get vector store from storage engine if available
    if (this.storageEngine) {
      this.vectorStore = this.storageEngine.getVectorStore() || undefined;
    }
    
    // Pass embedding service to storage engine if available
    if (this.storageEngine && 'setEmbeddingService' in this.storageEngine && typeof this.storageEngine.setEmbeddingService === 'function') {
      this.storageEngine.setEmbeddingService(
        this.embeddingGenerator.generate.bind(this.embeddingGenerator)
      );
    }
    
    this.initialized = true;
    logger.info("Intelligence layer initialized");
  }

  setEmbeddingService(service: (text: string) => Promise<number[]>): void {
    this.embeddingService = service;
  }

  setStorageEngine(storageEngine: StorageEngine): void {
    this.storageEngine = storageEngine;
  }

  setEmbeddingGenerator(embeddingGenerator: EmbeddingGenerator): void {
    this.embeddingGenerator = embeddingGenerator;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.initialized) {
      throw new Error("Intelligence layer not initialized");
    }

    logger.debug("Generating embedding", { textLength: text.length });
    
    // Use provided embedding service if available
    if (this.embeddingService) {
      return await this.embeddingService(text);
    }
    
    // Use embedding generator
    return await this.embeddingGenerator.generate(text);
  }

  async retrieveMemories(query: string, options: RetrievalOptions = {}): Promise<RetrievedMemory[]> {
    if (!this.initialized) {
      throw new Error("Intelligence layer not initialized");
    }

    const opts = {
      limit: options.limit || this.config.retrieval.topK,
      minScore: options.minScore || this.config.retrieval.minScore,
      includeMetadata: options.includeMetadata ?? this.config.context.includeMetadata,
      filters: options.filters || {}
    };

    logger.debug("Retrieving memories", { query, options: opts });
    
    // Check cache
    const cacheKey = JSON.stringify({ query, opts });
    if (this.queryCache.has(cacheKey)) {
      logger.debug("Cache hit for query");
      const cached = this.queryCache.get(cacheKey);
      if (!cached) {
        throw new Error('Cache entry not found');
      }
      return cached;
    }
    
    try {
      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(query);
      
      // Check if vector store is available
      if (!this.vectorStore && this.storageEngine) {
        this.vectorStore = this.storageEngine.getVectorStore() || undefined;
      }
      
      if (!this.vectorStore) {
        logger.warn("Vector store not available, falling back to SQL search");
        return this.fallbackSQLSearch(query, opts);
      }
      
      // Search for similar vectors
      const vectorResults = await this.vectorStore.search(queryEmbedding, {
        k: opts.limit * 2, // Get more candidates for reranking
        threshold: opts.minScore,
        filter: opts.filters
      });
      
      // Convert vector results to retrieved memories
      const memories: RetrievedMemory[] = vectorResults.map(result => ({
        id: result.id,
        content: result.metadata.content as string || "",
        score: result.score,
        metadata: result.metadata,
        timestamp: new Date(result.metadata.timestamp as string || Date.now()),
        eventType: result.metadata.eventType as string,
        sessionId: result.metadata.sessionId as string,
        workspaceId: result.metadata.workspaceId as string,
        gitBranch: result.metadata.gitBranch as string
      }));
      
      // Rerank if enabled
      let finalMemories = memories;
      if (this.config.retrieval.rerank && memories.length > 0) {
        finalMemories = this.rerankMemories(query, memories);
      }
      
      // Limit to requested number
      finalMemories = finalMemories.slice(0, opts.limit);
      
      // Cache results
      this.queryCache.set(cacheKey, finalMemories);
      
      // Limit cache size
      if (this.queryCache.size > 100) {
        const firstKey = this.queryCache.keys().next().value;
        if (firstKey) this.queryCache.delete(firstKey);
      }
      
      return finalMemories;
      
    } catch (error) {
      logger.error("Failed to retrieve memories", error);
      return this.fallbackSQLSearch(query, opts);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async buildContext(memories: RetrievedMemory[]): Promise<string> {
    if (!this.initialized) {
      throw new Error("Intelligence layer not initialized");
    }

    logger.debug("Building context", { memoryCount: memories.length });
    
    // Use context builder
    return this.contextBuilder.build(memories);
  }

  async close(): Promise<void> {
    logger.info("Closing intelligence layer...");
    
    // Clear cache
    this.queryCache.clear();
    
    // Close embedding generator
    await this.embeddingGenerator.close();
    
    // Close context builder if needed
    if (this.contextBuilder.close) {
      await this.contextBuilder.close();
    }
    
    this.initialized = false;
    logger.info("Intelligence layer closed");
  }

  private rerankMemories(
    query: string, 
    memories: RetrievedMemory[]
  ): RetrievedMemory[] {
    // Simple reranking based on metadata relevance
    // In production, use a cross-encoder model
    return memories.sort((a, b) => {
      let scoreA = a.score;
      let scoreB = b.score;
      
      // Boost recent memories
      const now = Date.now();
      const ageA = now - a.timestamp.getTime();
      const ageB = now - b.timestamp.getTime();
      const dayInMs = 24 * 60 * 60 * 1000;
      
      if (ageA < dayInMs) scoreA *= 1.2;
      if (ageB < dayInMs) scoreB *= 1.2;
      
      // Boost if query terms in metadata
      const queryTerms = query.toLowerCase().split(/\s+/);
      const metaA = JSON.stringify(a.metadata).toLowerCase();
      const metaB = JSON.stringify(b.metadata).toLowerCase();
      
      for (const term of queryTerms) {
        if (metaA.includes(term)) scoreA *= 1.1;
        if (metaB.includes(term)) scoreB *= 1.1;
      }
      
      return scoreB - scoreA;
    });
  }

  private fallbackSQLSearch(
    query: string, 
    options: Record<string, unknown>
  ): RetrievedMemory[] {
    if (!this.storageEngine) {
      logger.warn("No storage engine available for SQL fallback");
      return [];
    }

    try {
      // Fallback to keyword search in SQLite
      const memories = this.storageEngine.queryMemories({
        ...(options.filters as Record<string, string | Date | number | undefined>),
        limit: options.limit as number
      });
      
      // Simple relevance scoring based on query terms
      const queryTerms = query.toLowerCase().split(/\s+/);
      
      const results = memories
        .map(memory => {
          const content = memory.content.toLowerCase();
          let score = 0;
          
          for (const term of queryTerms) {
            if (content.includes(term)) {
              score += 0.3;
            }
          }
          
          return {
            id: memory.id,
            content: memory.content,
            score: Math.min(score, 1.0),
            metadata: memory.metadata,
            timestamp: memory.timestamp,
            eventType: memory.eventType,
            sessionId: memory.sessionId,
            workspaceId: memory.workspaceId,
            gitBranch: memory.gitBranch
          };
        })
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, options.limit as number);
      
      // Cache SQL fallback results too
      const cacheKey = JSON.stringify({ query, options });
      this.queryCache.set(cacheKey, results);
      
      return results;
    } catch (error) {
      logger.error("Failed to perform SQL fallback search", error);
      return [];
    }
  }

  getQueryCache(): Map<string, RetrievedMemory[]> {
    return this.queryCache;
  }
}