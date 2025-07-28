import { pipeline, Pipeline } from "@xenova/transformers";

// Constants for better maintainability
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSION = 384;
const DEFAULT_CACHE_SIZE = 1000;
const DEFAULT_BATCH_SIZE = 32;
const MAX_RETRY_ATTEMPTS = 2;
const MAX_PERFORMANCE_METRICS = 1000;
const PERFORMANCE_PERCENTILE_95 = 0.95;
const PERFORMANCE_PERCENTILE_99 = 0.99;

interface EmbeddingConfig {
  model?: string;
  cache?: boolean;
  cacheSize?: number;
  batchSize?: number;
}

interface CacheEntry {
  embedding: number[];
  timestamp: number;
}

interface PerformanceMetric {
  latency: number;
  timestamp: number;
}

export class EmbeddingGenerator {
  private config: EmbeddingConfig;
  private pipeline: Pipeline | null = null;
  private initialized = false;
  private closed = false;
  private cache = new Map<string, CacheEntry>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private performanceMetrics: PerformanceMetric[] = [];
  
  constructor(config: EmbeddingConfig = {}) {
    this.config = {
      model: config.model || DEFAULT_MODEL,
      cache: config.cache !== false,
      cacheSize: config.cacheSize || DEFAULT_CACHE_SIZE,
      batchSize: config.batchSize || DEFAULT_BATCH_SIZE
    };
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('EmbeddingGenerator already initialized');
    }
    
    // Load the model
    this.pipeline = await pipeline(
      'feature-extraction',
      this.config.model || DEFAULT_MODEL,
      { device: 'cpu' }
    );
    
    this.initialized = true;
  }
  
  // eslint-disable-next-line @typescript-eslint/require-await
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    
    this.closed = true;
    this.pipeline = null;
    this.cache.clear();
  }
  
  getModelInfo(): { name: string; dimension: number; ready: boolean } {
    return {
      name: this.config.model || DEFAULT_MODEL,
      dimension: EMBEDDING_DIMENSION,
      ready: this.initialized
    };
  }
  
  getBackend(): string {
    return 'cpu';
  }
  
  async generate(text: string): Promise<number[]> {
    if (this.closed) {
      throw new Error('EmbeddingGenerator has been closed');
    }
    
    if (!this.initialized) {
      throw new Error('EmbeddingGenerator not initialized');
    }
    
    if (!text || text.trim() === '') {
      throw new Error('Cannot generate embedding for empty text');
    }
    
    const start = Date.now();
    
    // Check cache
    const cachedEmbedding = this.getCachedEmbedding(text);
    if (cachedEmbedding) {
      const latency = Date.now() - start;
      this.recordMetric(latency);
      return cachedEmbedding;
    }
    
    try {
      const embedding = await this.generateWithRetry(text);
      
      // Cache result
      if (this.config.cache) {
        this.addToCache(text, embedding);
      }
      
      const latency = Date.now() - start;
      this.recordMetric(latency);
      
      return embedding;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.startsWith('Failed to generate embedding') || 
          errorMessage.startsWith('Out of memory') ||
          errorMessage === 'Invalid embedding output format') {
        throw error;
      }
      throw new Error(`Failed to generate embedding: ${errorMessage}`);
    }
  }
  
  async generateBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    
    // Filter out empty texts
    const validTexts = texts.filter(t => t && t.trim() !== '');
    if (validTexts.length === 0) {
      return [];
    }
    
    const start = Date.now();
    const results = await this.processBatches(validTexts);
    
    const latency = Date.now() - start;
    this.recordMetric(latency);
    
    return results;
  }
  
  /**
   * Processes texts in batches for efficient embedding generation
   * @param texts The texts to process
   * @returns Array of embeddings in the same order as input texts
   */
  private async processBatches(texts: string[]): Promise<number[][]> {
    const results: number[][] = new Array<number[]>(texts.length);
    const batches = this.createBatches(texts);
    
    // Process all batches in parallel
    const batchPromises = batches.map(({ batch, startIndex }) => 
      this.processSingleBatch(batch, startIndex, results)
    );
    
    await Promise.all(batchPromises);
    return results;
  }
  
  /**
   * Creates batches from input texts
   * @param texts The texts to batch
   * @returns Array of batch descriptors
   */
  private createBatches(texts: string[]): Array<{ batch: string[]; startIndex: number }> {
    const batches: Array<{ batch: string[]; startIndex: number }> = [];
    const batchSize = this.config.batchSize || DEFAULT_BATCH_SIZE;
    
    for (let i = 0; i < texts.length; i += batchSize) {
      batches.push({
        batch: texts.slice(i, i + batchSize),
        startIndex: i
      });
    }
    
    return batches;
  }
  
  /**
   * Processes a single batch of texts
   * @param batch The batch of texts to process
   * @param startIndex The starting index in the results array
   * @param results The results array to populate
   */
  private async processSingleBatch(
    batch: string[], 
    startIndex: number, 
    results: number[][]
  ): Promise<void> {
    if (!this.pipeline) {
      throw new Error('Pipeline not initialized');
    }
    const output = await this.pipeline(batch, {
      pooling: 'mean',
      normalize: true
    });
    
    const batchEmbeddings = this.extractBatchEmbeddings(output, batch.length);
    
    // Insert embeddings and cache if enabled
    batchEmbeddings.forEach((embedding, index) => {
      results[startIndex + index] = embedding;
      
      if (this.config.cache) {
        const batchText = batch[index];
        if (batchText) {
          this.addToCache(batchText, embedding);
        }
      }
    });
  }
  
  getCacheStats(): {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      size: this.cache.size,
      maxSize: this.config.cacheSize || DEFAULT_CACHE_SIZE,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0
    };
  }
  
  clearCache(): void {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
  
  getPerformanceMetrics(): {
    totalOperations: number;
    averageLatency: number;
    p95Latency: number;
    p99Latency: number;
  } {
    if (this.performanceMetrics.length === 0) {
      return {
        totalOperations: 0,
        averageLatency: 0,
        p95Latency: 0,
        p99Latency: 0
      };
    }
    
    const latencies = this.performanceMetrics.map(m => m.latency).sort((a, b) => a - b);
    const sum = latencies.reduce((a, b) => a + b, 0);
    const p95Index = Math.floor(latencies.length * PERFORMANCE_PERCENTILE_95);
    const p99Index = Math.floor(latencies.length * PERFORMANCE_PERCENTILE_99);
    
    return {
      totalOperations: this.performanceMetrics.length,
      averageLatency: sum / latencies.length,
      p95Latency: latencies[p95Index] ?? latencies[latencies.length - 1] ?? 0,
      p99Latency: latencies[p99Index] ?? latencies[latencies.length - 1] ?? 0
    };
  }
  
  private addToCache(text: string, embedding: number[]): void {
    // Enforce cache size limit
    if (this.cache.size >= (this.config.cacheSize || DEFAULT_CACHE_SIZE)) {
      // Remove oldest entry (simple LRU)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(text, {
      embedding,
      timestamp: Date.now()
    });
  }
  
  private recordMetric(latency: number): void {
    this.performanceMetrics.push({
      latency,
      timestamp: Date.now()
    });
    
    // Keep only last MAX_PERFORMANCE_METRICS metrics
    if (this.performanceMetrics.length > MAX_PERFORMANCE_METRICS) {
      this.performanceMetrics = this.performanceMetrics.slice(-MAX_PERFORMANCE_METRICS);
    }
  }
  
  /**
   * Generates embedding with retry logic for transient failures
   * @param text The text to generate embedding for
   * @returns The generated embedding
   * @throws Error if generation fails after retries
   */
  private async generateWithRetry(text: string): Promise<number[]> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        if (!this.pipeline) {
          throw new Error('Pipeline not initialized');
        }
        const output = await this.pipeline(text, {
          pooling: 'mean',
          normalize: true
        });
        
        if (!output.data) {
          throw new Error('Invalid embedding output format');
        }
        
        return Array.from(output.data);
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry for OOM errors
        if (lastError.message.includes('OOM')) {
          throw new Error('Out of memory while generating embedding');
        }
        
        // Only retry once for other errors
        if (attempt === 0) {
          continue;
        }
        break;
      }
    }
    
    throw new Error(`Failed to generate embedding: ${lastError ? lastError.message : 'Unknown error'}`);
  }
  
  /**
   * Extracts individual embeddings from batch output
   * @param batchOutput The raw batch output from the pipeline
   * @param batchSize The number of texts in the batch
   * @returns Array of individual embeddings
   */
  private extractBatchEmbeddings(batchOutput: unknown, batchSize: number): number[][] {
    const embeddings: number[][] = [];
    
    // Type check the batch output
    if (!batchOutput || typeof batchOutput !== 'object' || !('data' in batchOutput)) {
      throw new Error('Invalid batch output format');
    }
    
    const output = batchOutput as { data: Float32Array };
    
    for (let i = 0; i < batchSize; i++) {
      const startIdx = i * EMBEDDING_DIMENSION;
      const endIdx = startIdx + EMBEDDING_DIMENSION;
      const embedding: number[] = Array.from(output.data.slice(startIdx, endIdx));
      embeddings.push(embedding);
    }
    
    return embeddings;
  }
  
  /**
   * Retrieves embedding from cache if available
   * @param text The text to look up in cache
   * @returns The cached embedding or null if not found
   */
  private getCachedEmbedding(text: string): number[] | null {
    if (!this.config.cache) {
      return null;
    }
    
    if (this.cache.has(text)) {
      this.cacheHits++;
      const cached = this.cache.get(text);
      if (!cached) {
        throw new Error('Cache entry not found');
      }
      return cached.embedding;
    }
    
    this.cacheMisses++;
    return null;
  }
}
