import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { EmbeddingGenerator } from "../../src/intelligence/embeddings.js";
import * as transformersModule from "@xenova/transformers";

// Mock @xenova/transformers
jest.mock("@xenova/transformers");

describe('EmbeddingGenerator', () => {
  let generator: EmbeddingGenerator;
  let mockPipeline: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPipeline = jest.fn();
    
    // Setup the mock for the transformers module
    const mockedPipeline = transformersModule.pipeline as jest.MockedFunction<typeof transformersModule.pipeline>;
    mockedPipeline.mockResolvedValue(mockPipeline as any);
  });

  afterEach(async () => {
    if (generator) {
      await generator.close().catch(() => {});
    }
  });

  describe('initialization', () => {
    it('should load specified model', async () => {
      // Given: Model configuration
      generator = new EmbeddingGenerator({
        model: 'Xenova/all-MiniLM-L6-v2'
      });
      
      // When: Initializing
      await generator.initialize();
      
      // Then: Model is loaded with correct parameters
      expect(transformersModule.pipeline).toHaveBeenCalledWith(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        expect.any(Object)
      );
      
      const modelInfo = generator.getModelInfo();
      expect(modelInfo).toEqual({
        name: 'Xenova/all-MiniLM-L6-v2',
        dimension: 384,
        ready: true
      });
    });

    it('should use default model when none specified', async () => {
      // Given: No model specified
      generator = new EmbeddingGenerator({});
      
      // When: Initializing
      await generator.initialize();
      
      // Then: Default model is loaded
      expect(transformersModule.pipeline).toHaveBeenCalledWith(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        expect.any(Object)
      );
    });

    it('should fallback to CPU if GPU unavailable', async () => {
      // Given: Platform check indicates no GPU
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      });
      
      // When: Initializing
      generator = new EmbeddingGenerator({});
      await generator.initialize();
      
      // Then: CPU backend is used
      expect(generator.getBackend()).toBe('cpu');
      
      // Cleanup
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true
      });
    });

    it('should throw if model loading fails', async () => {
      // Given: Model loading will fail
      const mockedPipeline = transformersModule.pipeline as jest.MockedFunction<typeof transformersModule.pipeline>;
      mockedPipeline.mockRejectedValue(new Error('Model not found'));
      
      generator = new EmbeddingGenerator({
        model: 'invalid/model'
      });
      
      // When/Then: Initialization fails
      await expect(generator.initialize()).rejects.toThrow('Model not found');
    });

    it('should prevent double initialization', async () => {
      // Given: Already initialized generator
      generator = new EmbeddingGenerator({});
      await generator.initialize();
      
      // When/Then: Second initialization throws
      await expect(generator.initialize()).rejects.toThrow(
        'EmbeddingGenerator already initialized'
      );
    });
  });

  describe('embedding generation', () => {
    beforeEach(async () => {
      // Setup mock pipeline to return embeddings
      mockPipeline.mockImplementation(async () => ({
        data: new Float32Array(384).fill(0).map(() => Math.random() - 0.5),
        dims: [1, 384]
      }));
      
      generator = new EmbeddingGenerator({
        model: 'Xenova/all-MiniLM-L6-v2'
      });
      await generator.initialize();
    });

    it('should generate embeddings for text', async () => {
      // Given: Text input
      const text = 'Hello world';
      
      // When: Generating embedding
      const embedding = await generator.generate(text);
      
      // Then: Embedding has correct dimensions and properties
      expect(embedding).toHaveLength(384);
      expect(embedding).toBeInstanceOf(Array);
      expect(embedding.every((x: number) => typeof x === 'number')).toBe(true);
      expect(embedding.every((x: number) => x >= -1 && x <= 1)).toBe(true);
      
      // Verify pipeline was called correctly
      expect(mockPipeline).toHaveBeenCalledWith(text, {
        pooling: 'mean',
        normalize: true
      });
    });

    it('should handle empty text', async () => {
      // Given: Empty text
      const text = '';
      
      // When/Then: Should throw meaningful error
      await expect(generator.generate(text)).rejects.toThrow(
        'Cannot generate embedding for empty text'
      );
    });

    it('should handle very long text by truncating', async () => {
      // Given: Very long text (over token limit)
      const longText = 'word '.repeat(1000);
      
      // When: Generating embedding
      const embedding = await generator.generate(longText);
      
      // Then: Should succeed with truncation
      expect(embedding).toHaveLength(384);
      expect(mockPipeline).toHaveBeenCalled();
    });

    it('should throw when used before initialization', async () => {
      // Given: Uninitialized generator
      const uninitializedGenerator = new EmbeddingGenerator({});
      
      // When/Then: Generate throws
      await expect(uninitializedGenerator.generate('test')).rejects.toThrow(
        'EmbeddingGenerator not initialized'
      );
    });
  });

  describe('batch processing', () => {
    beforeEach(async () => {
      // Setup mock pipeline for batch processing
      mockPipeline.mockImplementation(async (texts: any) => {
        const textArray = Array.isArray(texts) ? texts : [texts];
        return {
          data: new Float32Array(textArray.length * 384).fill(0).map(() => Math.random() - 0.5),
          dims: [textArray.length, 384]
        };
      });
      
      generator = new EmbeddingGenerator({ 
        batchSize: 2,
        model: 'Xenova/all-MiniLM-L6-v2'
      });
      await generator.initialize();
    });

    it('should batch process multiple texts', async () => {
      // Given: Multiple texts
      const texts = [
        'First document about testing',
        'Second document about development',
        'Third document about deployment'
      ];
      
      // When: Batch processing
      const embeddings = await generator.generateBatch(texts);
      
      // Then: All embeddings generated with correct batching
      expect(embeddings).toHaveLength(3);
      expect(embeddings[0]).toHaveLength(384);
      expect(embeddings[1]).toHaveLength(384);
      expect(embeddings[2]).toHaveLength(384);
      
      // Verify batching occurred (2 calls for batch size 2)
      expect(mockPipeline).toHaveBeenCalledTimes(2);
    });

    it('should handle empty batch', async () => {
      // Given: Empty array
      const texts: string[] = [];
      
      // When: Batch processing
      const embeddings = await generator.generateBatch(texts);
      
      // Then: Returns empty array
      expect(embeddings).toEqual([]);
      expect(mockPipeline).not.toHaveBeenCalled();
    });

    it('should handle single item batch', async () => {
      // Given: Single text
      const texts = ['Single document'];
      
      // When: Batch processing
      const embeddings = await generator.generateBatch(texts);
      
      // Then: Returns array with one embedding
      expect(embeddings).toHaveLength(1);
      expect(embeddings[0]).toHaveLength(384);
    });

    it('should filter out empty texts in batch', async () => {
      // Given: Batch with empty strings
      const texts = ['First', '', 'Third', '   ', 'Fifth'];
      
      // When: Batch processing
      const embeddings = await generator.generateBatch(texts);
      
      // Then: Only non-empty texts processed
      expect(embeddings).toHaveLength(3);
    });

    it('should respect batch size configuration', async () => {
      // Given: Large batch
      const texts = Array(10).fill(0).map((_, i) => `Document ${i}`);
      
      // When: Processing with batch size 3
      const customGenerator = new EmbeddingGenerator({ 
        batchSize: 3,
        model: 'Xenova/all-MiniLM-L6-v2'
      });
      await customGenerator.initialize();
      
      await customGenerator.generateBatch(texts);
      
      // Then: Pipeline called correct number of times (10 items / 3 batch size = 4 calls)
      expect(mockPipeline).toHaveBeenCalledTimes(4);
      
      await customGenerator.close().catch(() => {});
    });
  });

  describe('caching', () => {
    beforeEach(async () => {
      // Setup mock to track cache behavior
      mockPipeline.mockImplementation(async () => {
        // Simulate actual computation time
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
          data: new Float32Array(384).fill(0).map((_, i) => i / 384),
          dims: [1, 384]
        };
      });
      
      generator = new EmbeddingGenerator({ 
        cache: true,
        cacheSize: 100,
        model: 'Xenova/all-MiniLM-L6-v2'
      });
      await generator.initialize();
    });

    it('should cache embeddings', async () => {
      // Given: Caching enabled
      const text = 'Cached text for testing';
      
      // When: Generating same text twice
      const start1 = Date.now();
      const embedding1 = await generator.generate(text);
      const time1 = Date.now() - start1;
      
      const start2 = Date.now();
      const embedding2 = await generator.generate(text);
      const time2 = Date.now() - start2;
      
      // Then: Second call is faster (cached) and returns same result
      expect(embedding1).toEqual(embedding2);
      expect(time2).toBeLessThan(time1 / 5); // At least 5x faster
      expect(mockPipeline).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should respect cache size limit', async () => {
      // Given: Small cache size
      const smallCacheGenerator = new EmbeddingGenerator({ 
        cache: true,
        cacheSize: 2,
        model: 'Xenova/all-MiniLM-L6-v2'
      });
      await smallCacheGenerator.initialize();
      
      // When: Generating more texts than cache size
      await smallCacheGenerator.generate('Text 1');
      await smallCacheGenerator.generate('Text 2');
      await smallCacheGenerator.generate('Text 3'); // Should evict 'Text 1'
      
      // Then: Cache statistics reflect eviction
      const stats = smallCacheGenerator.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(2);
      
      await smallCacheGenerator.close().catch(() => {});
    });

    it('should track cache hit rate', async () => {
      // Given: Multiple operations
      const texts = ['A', 'B', 'A', 'C', 'B', 'A'];
      
      // When: Processing with cache
      for (const text of texts) {
        await generator.generate(text);
      }
      
      // Then: Cache stats are accurate
      const stats = generator.getCacheStats();
      expect(stats.hits).toBe(3); // 'A' twice, 'B' once
      expect(stats.misses).toBe(3); // First occurrence of each
      expect(stats.hitRate).toBeCloseTo(0.5, 2);
    });

    it('should clear cache on demand', async () => {
      // Given: Populated cache
      await generator.generate('Text 1');
      await generator.generate('Text 2');
      
      let stats = generator.getCacheStats();
      expect(stats.size).toBe(2);
      
      // When: Clearing cache
      generator.clearCache();
      
      // Then: Cache is empty
      stats = generator.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should work without cache when disabled', async () => {
      // Given: Cache disabled
      const noCacheGenerator = new EmbeddingGenerator({ 
        cache: false,
        model: 'Xenova/all-MiniLM-L6-v2'
      });
      await noCacheGenerator.initialize();
      
      // When: Generating same text twice
      await noCacheGenerator.generate('Same text');
      await noCacheGenerator.generate('Same text');
      
      // Then: Pipeline called twice (no caching)
      expect(mockPipeline).toHaveBeenCalledTimes(2);
      
      await noCacheGenerator.close().catch(() => {});
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      generator = new EmbeddingGenerator({
        model: 'Xenova/all-MiniLM-L6-v2'
      });
      await generator.initialize();
    });

    it('should handle pipeline errors gracefully', async () => {
      // Given: Pipeline will fail
      mockPipeline.mockRejectedValue(new Error('Pipeline processing failed'));
      
      // When/Then: Error is propagated with context
      await expect(generator.generate('test')).rejects.toThrow(
        'Failed to generate embedding: Pipeline processing failed'
      );
    });

    it('should handle invalid model output', async () => {
      // Given: Pipeline returns invalid format
      mockPipeline.mockResolvedValue({
        data: null,
        dims: [1, 384]
      });
      
      // When/Then: Error is thrown
      await expect(generator.generate('test')).rejects.toThrow(
        'Invalid embedding output format'
      );
    });

    it('should handle out of memory errors', async () => {
      // Given: Simulated OOM error
      mockPipeline.mockRejectedValue(new Error('OOM: Out of memory'));
      
      // When/Then: Specific OOM handling
      await expect(generator.generate('test')).rejects.toThrow(
        'Out of memory while generating embedding'
      );
    });

    it('should retry on transient failures', async () => {
      // Given: First call fails, second succeeds
      let callCount = 0;
      mockPipeline.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Transient error');
        }
        return {
          data: new Float32Array(384).fill(0.1),
          dims: [1, 384]
        };
      });
      
      // When: Generating embedding
      const embedding = await generator.generate('test with retry');
      
      // Then: Succeeds after retry
      expect(embedding).toHaveLength(384);
      expect(mockPipeline).toHaveBeenCalledTimes(2);
    });
  });

  describe('performance', () => {
    beforeEach(async () => {
      // Setup realistic mock timing
      mockPipeline.mockImplementation(async (text: any) => {
        const count = Array.isArray(text) ? text.length : 1;
        await new Promise(resolve => setTimeout(resolve, 50 * count));
        return {
          data: new Float32Array(count * 384).fill(0.1),
          dims: [count, 384]
        };
      });
      
      generator = new EmbeddingGenerator({
        model: 'Xenova/all-MiniLM-L6-v2',
        cache: true,
        batchSize: 10
      });
      await generator.initialize();
    });

    it('should meet performance requirements for single embedding', async () => {
      // Given: Performance requirement of < 200ms
      const text = 'Performance test text';
      
      // When: Generating embedding
      const start = Date.now();
      await generator.generate(text);
      const duration = Date.now() - start;
      
      // Then: Meets performance requirement
      expect(duration).toBeLessThan(200);
    });

    it('should efficiently batch process large sets', async () => {
      // Given: Large set of texts
      const texts = Array(50).fill(0).map((_, i) => `Document ${i}`);
      
      // When: Batch processing
      const start = Date.now();
      await generator.generateBatch(texts);
      const duration = Date.now() - start;
      
      // Then: Efficient batching (should take ~500ms with parallel processing, not 2500ms sequential)
      // Allow 520ms to account for parallel processing overhead
      expect(duration).toBeLessThan(520);
      expect(mockPipeline).toHaveBeenCalledTimes(5); // 50 items / 10 batch size
    });

    it('should track performance metrics', async () => {
      // Given: Multiple operations
      const operations = [
        () => generator.generate('Quick text'),
        () => generator.generateBatch(['Text 1', 'Text 2', 'Text 3']),
        () => generator.generate('Quick text'), // Cached
      ];
      
      // When: Executing operations
      for (const op of operations) {
        await op();
      }
      
      // Then: Performance metrics available
      const metrics = generator.getPerformanceMetrics();
      expect(metrics.totalOperations).toBe(3);
      expect(metrics.averageLatency).toBeGreaterThan(0);
      expect(metrics.p95Latency).toBeGreaterThan(0);
      expect(metrics.p99Latency).toBeGreaterThan(0);
    });
  });

  describe('cleanup', () => {
    it('should properly close and cleanup resources', async () => {
      // Given: Initialized generator
      generator = new EmbeddingGenerator({
        model: 'Xenova/all-MiniLM-L6-v2',
        cache: true
      });
      await generator.initialize();
      
      // When: Closing
      await generator.close();
      
      // Then: Cannot use after close
      await expect(generator.generate('test')).rejects.toThrow(
        'EmbeddingGenerator has been closed'
      );
      
      // And: Resources are cleaned up
      const stats = generator.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should handle multiple close calls gracefully', async () => {
      // Given: Initialized generator
      generator = new EmbeddingGenerator({});
      await generator.initialize();
      
      // When: Closing multiple times
      await generator.close();
      await generator.close(); // Should not throw
      
      // Then: No errors
      expect(true).toBe(true);
    });
  });
});