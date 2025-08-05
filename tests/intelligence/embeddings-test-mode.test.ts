import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { EmbeddingGenerator } from "../../src/intelligence/embeddings.js";

/**
 * Tests for EmbeddingGenerator in test mode (NODE_ENV='test')
 * This file tests the built-in test mode behavior that prevents external model downloads
 */
describe('EmbeddingGenerator - Test Mode', () => {
  let generator: EmbeddingGenerator;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    // Ensure we're in test mode
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
  });

  afterEach(async () => {
    // Restore NODE_ENV
    process.env.NODE_ENV = originalNodeEnv;
    
    if (generator) {
      await generator.close().catch(() => {});
    }
  });

  describe('initialization in test mode', () => {
    it('should initialize without downloading models', async () => {
      // Given: Test environment
      generator = new EmbeddingGenerator({
        model: 'Xenova/all-MiniLM-L6-v2'
      });
      
      // When: Initializing
      await generator.initialize();
      
      // Then: Should initialize successfully without network calls
      const modelInfo = generator.getModelInfo();
      expect(modelInfo).toEqual({
        name: 'Xenova/all-MiniLM-L6-v2',
        dimension: 384,
        ready: true
      });
    });

    it('should use deterministic embeddings', async () => {
      // Given: Test mode generator
      generator = new EmbeddingGenerator();
      await generator.initialize();
      
      // When: Generating embeddings for the same text
      const text = 'test text';
      const embedding1 = await generator.generate(text);
      const embedding2 = await generator.generate(text);
      
      // Then: Should produce identical embeddings
      expect(embedding1).toEqual(embedding2);
      expect(embedding1).toHaveLength(384);
    });

    it('should produce different embeddings for different texts', async () => {
      // Given: Test mode generator
      generator = new EmbeddingGenerator();
      await generator.initialize();
      
      // When: Generating embeddings for different texts
      const embedding1 = await generator.generate('hello');
      const embedding2 = await generator.generate('world');
      
      // Then: Embeddings should be different
      expect(embedding1).not.toEqual(embedding2);
      expect(embedding1).toHaveLength(384);
      expect(embedding2).toHaveLength(384);
    });

    it('should handle empty text gracefully', async () => {
      // Given: Test mode generator
      generator = new EmbeddingGenerator();
      await generator.initialize();
      
      // When/Then: Should throw for empty text
      await expect(generator.generate('')).rejects.toThrow('Cannot generate embedding for empty text');
    });
  });

  describe('batch processing in test mode', () => {
    it('should batch process multiple texts', async () => {
      // Given: Test mode generator
      generator = new EmbeddingGenerator({ batchSize: 2 });
      await generator.initialize();
      
      // When: Batch processing
      const texts = ['text1', 'text2', 'text3'];
      const embeddings = await generator.generateBatch(texts);
      
      // Then: Should return embeddings for all texts
      expect(embeddings).toHaveLength(3);
      embeddings.forEach(embedding => {
        expect(embedding).toHaveLength(384);
      });
    });
  });

  describe('caching in test mode', () => {
    it('should cache embeddings', async () => {
      // Given: Test mode generator with caching
      generator = new EmbeddingGenerator({ cache: true });
      await generator.initialize();
      
      // When: Generating same text multiple times
      const text = 'cached text';
      const embedding1 = await generator.generate(text);
      const embedding2 = await generator.generate(text);
      
      // Then: Should return same embeddings
      expect(embedding1).toEqual(embedding2);
      
      // And: Cache should have the entry
      const cacheStats = generator.getCacheStats();
      expect(cacheStats.size).toBe(1);
      expect(cacheStats.hits).toBe(1); // Second call was a cache hit
      expect(cacheStats.misses).toBe(1); // First call was a cache miss
      expect(cacheStats.hitRate).toBeCloseTo(0.5); // 1 hit / 2 total calls
    });

    it('should work without cache when disabled', async () => {
      // Given: Test mode generator without caching
      generator = new EmbeddingGenerator({ cache: false });
      await generator.initialize();
      
      // When: Generating same text multiple times
      const text = 'uncached text';
      const embedding1 = await generator.generate(text);
      const embedding2 = await generator.generate(text);
      
      // Then: Should still produce same embeddings
      expect(embedding1).toEqual(embedding2);
    });
  });

  describe('performance in test mode', () => {
    it('should generate embeddings quickly', async () => {
      // Given: Test mode generator
      generator = new EmbeddingGenerator();
      await generator.initialize();
      
      // When: Generating embedding
      const startTime = Date.now();
      await generator.generate('performance test');
      const elapsed = Date.now() - startTime;
      
      // Then: Should be very fast (no network calls)
      expect(elapsed).toBeLessThan(100); // Should be < 100ms in test mode
    });

    it('should handle large batches efficiently', async () => {
      // Given: Test mode generator
      generator = new EmbeddingGenerator({ batchSize: 100 });
      await generator.initialize();
      
      // When: Processing large batch
      const texts = Array(1000).fill(null).map((_, i) => `text ${i}`);
      const startTime = Date.now();
      const embeddings = await generator.generateBatch(texts);
      const elapsed = Date.now() - startTime;
      
      // Then: Should process quickly
      expect(embeddings).toHaveLength(1000);
      expect(elapsed).toBeLessThan(1000); // Should be < 1s for 1000 texts
    });
  });

  describe('error handling in test mode', () => {
    it('should handle invalid inputs', async () => {
      // Given: Test mode generator
      generator = new EmbeddingGenerator();
      await generator.initialize();
      
      // When/Then: Should handle errors appropriately
      await expect(generator.generate('')).rejects.toThrow('Cannot generate embedding for empty text');
      await expect(generator.generate('   ')).rejects.toThrow('Cannot generate embedding for empty text');
    });

    it('should prevent usage before initialization', async () => {
      // Given: Uninitialized generator
      generator = new EmbeddingGenerator();
      
      // When/Then: Should throw
      await expect(generator.generate('test')).rejects.toThrow('EmbeddingGenerator not initialized');
    });
  });

  describe('cleanup in test mode', () => {
    it('should properly close resources', async () => {
      // Given: Test mode generator
      generator = new EmbeddingGenerator();
      await generator.initialize();
      
      // When: Closing
      await generator.close();
      
      // Then: Should not be able to use after closing
      await expect(generator.generate('test')).rejects.toThrow('EmbeddingGenerator has been closed');
    });

    it('should handle multiple close calls', async () => {
      // Given: Test mode generator
      generator = new EmbeddingGenerator();
      await generator.initialize();
      
      // When/Then: Multiple closes should not throw
      await generator.close();
      await generator.close();
      await generator.close();
    });
  });
});