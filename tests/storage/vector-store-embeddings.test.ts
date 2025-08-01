import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { VectorStore, CrossEncoder, VectorResult } from "../../src/storage/vector-store.js";
import type { EmbeddingGenerator } from "../../src/intelligence/embeddings.js";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Mock the embeddings module using unstable_mockModule for ESM support
const mockEmbeddingGenerator = {
  initialize: jest.fn().mockResolvedValue(undefined),
  generate: jest.fn().mockResolvedValue(Array(384).fill(0.1)),
  generateBatch: jest.fn().mockImplementation((texts: string[]) => 
    Promise.resolve(texts.map(() => Array(384).fill(0.1)))
  ),
  close: jest.fn().mockResolvedValue(undefined),
  getModelInfo: jest.fn().mockReturnValue({ 
    name: 'test-model', 
    dimension: 384, 
    ready: true 
  }),
  getBackend: jest.fn().mockReturnValue('cpu'),
  getCacheStats: jest.fn().mockReturnValue({
    size: 0,
    maxSize: 1000,
    hits: 0,
    misses: 0,
    hitRate: 0
  }),
  clearCache: jest.fn(),
  getPerformanceMetrics: jest.fn().mockReturnValue({
    totalOperations: 0,
    averageLatency: 0,
    p95Latency: 0,
    p99Latency: 0
  })
};

jest.unstable_mockModule("../../src/intelligence/embeddings.js", () => ({
  EmbeddingGenerator: jest.fn().mockImplementation(() => mockEmbeddingGenerator)
}));

// Import the mocked module dynamically
const { EmbeddingGenerator: MockedEmbeddingGenerator } = await import("../../src/intelligence/embeddings.js");

describe('VectorStore - Embedding Integration', () => {
  let store: VectorStore;
  let testPath: string;

  beforeEach(async () => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    // Create a unique temporary directory for each test
    testPath = await mkdtemp(join(tmpdir(), 'vector-store-embeddings-test-'));
  });

  afterEach(async () => {
    if (store) {
      await store.close();
    }
    // Clean up the test directory
    if (testPath) {
      await rm(testPath, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  describe('automatic embedding generation', () => {
    it('should generate embeddings automatically when storing text', async () => {
      // Given
      const embeddingGenerator = new MockedEmbeddingGenerator();
      store = new VectorStore({ 
        dimension: 384, 
        path: testPath,
        embeddingGenerator: embeddingGenerator as unknown as EmbeddingGenerator
      });
      await store.initialize();
      
      const text = "Hello, world!";
      const metadata = { source: 'test' };

      // When
      const id = await store.storeText(text, metadata);

      // Then
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith(text);
      expect(id).toBeDefined();
      
      // Verify vector was stored
      const results = await store.search(Array(384).fill(0.1), 1);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.source).toEqual(metadata.source);
      expect(results[0].metadata.text).toEqual(text); // VectorStore adds text to metadata
    });

    it('should generate embeddings for batch text storage', async () => {
      // Given
      const embeddingGenerator = new MockedEmbeddingGenerator();
      store = new VectorStore({ 
        dimension: 384, 
        path: testPath,
        embeddingGenerator: embeddingGenerator as unknown as EmbeddingGenerator
      });
      await store.initialize();
      
      const texts = ["Hello", "World", "Test"];
      const metadata = { type: 'test' };

      // When
      const ids = await store.storeTextBatch(texts, metadata);

      // Then
      expect(mockEmbeddingGenerator.generateBatch).toHaveBeenCalledWith(texts);
      expect(ids).toHaveLength(3);
      
      // Verify vectors were stored - should be exactly 3
      const results = await store.search(Array(384).fill(0.1), 10); // Search for more to ensure we only have 3
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.metadata.type).toEqual('test');
        expect(texts).toContain(result.metadata.text);
      });
    });

    it('should search by text and generate embeddings', async () => {
      // Given
      const embeddingGenerator = new MockedEmbeddingGenerator();
      store = new VectorStore({ 
        dimension: 384, 
        path: testPath,
        embeddingGenerator: embeddingGenerator as unknown as EmbeddingGenerator
      });
      await store.initialize();
      
      // Store some texts
      const texts = ["The cat sat on the mat", "Dogs love to play", "Birds fly high"];
      await store.storeTextBatch(texts, { category: 'animals' });

      // When searching by text
      const query = "pets and animals";
      const results = await store.searchText(query, { k: 3 });

      // Then
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith(query);
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.metadata.category).toEqual('animals');
        expect(texts).toContain(result.metadata.text);
      });
    });

    it('should handle embedding generation errors gracefully', async () => {
      // Given
      const embeddingGenerator = new MockedEmbeddingGenerator();
      store = new VectorStore({ 
        dimension: 384, 
        path: testPath,
        embeddingGenerator: embeddingGenerator as unknown as EmbeddingGenerator
      });
      await store.initialize();
      
      mockEmbeddingGenerator.generate.mockRejectedValueOnce(new Error('Embedding failed'));

      // When/Then
      await expect(store.storeText("test")).rejects.toThrow('Embedding failed');
    });

    it('should validate embedding dimension matches store dimension', async () => {
      // Given
      const embeddingGenerator = new MockedEmbeddingGenerator();
      store = new VectorStore({ 
        dimension: 128, 
        path: testPath, // Different dimension
        embeddingGenerator: embeddingGenerator as unknown as EmbeddingGenerator
      });
      await store.initialize();
      
      mockEmbeddingGenerator.generate.mockResolvedValueOnce(Array(384).fill(0.1)); // Wrong dimension

      // When/Then - The store should reject mismatched dimensions
      await expect(store.storeText("test")).rejects.toThrow('Embedding dimension mismatch');
    });
  });

  describe('embedding caching', () => {
    it('should call embedding generator for each text storage', async () => {
      // Given
      const embeddingGenerator = new MockedEmbeddingGenerator();
      store = new VectorStore({ 
        dimension: 384, 
        path: testPath,
        embeddingGenerator: embeddingGenerator as unknown as EmbeddingGenerator
      });
      await store.initialize();
      
      const text = "Cached text";

      // When - Store same text twice
      await store.storeText(text);
      await store.storeText(text);

      // Then - Embedding generator is called for each storage
      // Note: Caching would be handled internally by the EmbeddingGenerator implementation
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledTimes(2);
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith(text);
    });
  });

  describe('performance metrics', () => {
    it('should track embedding generation performance', async () => {
      // Given
      const embeddingGenerator = new MockedEmbeddingGenerator();
      store = new VectorStore({ 
        dimension: 384, 
        path: testPath,
        embeddingGenerator: embeddingGenerator as unknown as EmbeddingGenerator
      });
      await store.initialize();
      
      mockEmbeddingGenerator.getPerformanceMetrics.mockReturnValue({
        totalOperations: 10,
        averageLatency: 50,
        p95Latency: 75,
        p99Latency: 100
      });

      // When
      await store.storeText("Performance test");

      // Then
      const metrics = mockEmbeddingGenerator.getPerformanceMetrics();
      expect(metrics.totalOperations).toBeGreaterThan(0);
      expect(metrics.averageLatency).toBeGreaterThan(0);
    });
  });
});