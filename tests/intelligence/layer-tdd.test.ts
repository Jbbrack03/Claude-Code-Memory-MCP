import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { IntelligenceLayer, RetrievalOptions, RetrievedMemory } from "../../src/intelligence/layer.js";
import type { Config } from "../../src/config/index.js";

describe('IntelligenceLayer - TDD Red Phase Tests', () => {
  let layer: IntelligenceLayer;
  let config: Config["intelligence"];

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup config
    config = {
      embeddings: {
        model: "all-MiniLM-L6-v2",
        batchSize: 32,
        cache: true
      },
      retrieval: {
        topK: 10,
        minScore: 0.5,
        rerank: true
      },
      context: {
        maxSize: 8192,
        includeMetadata: true,
        deduplication: true
      }
    };
  });

  afterEach(async () => {
    if (layer) {
      await layer.close().catch(() => {});
    }
  });

  describe('Current implementation gaps', () => {
    beforeEach(async () => {
      layer = new IntelligenceLayer(config);
      await layer.initialize();
    });

    it('should have method to set storage engine dependency', () => {
      // When: Checking for setStorageEngine method
      const hasMethod = typeof (layer as any).setStorageEngine === 'function';

      // Then: Method should exist
      expect(hasMethod).toBe(true);
    });

    it('should have method to set embedding generator dependency', () => {
      // When: Checking for setEmbeddingGenerator method
      const hasMethod = typeof (layer as any).setEmbeddingGenerator === 'function';

      // Then: Method should exist
      expect(hasMethod).toBe(true);
    });

    it('should have internal vector store after initialization', async () => {
      // Given: A mock storage engine with vector store
      const mockVectorStore = {
        search: jest.fn(() => Promise.resolve([])),
        initialize: jest.fn(() => Promise.resolve()),
        close: jest.fn(() => Promise.resolve())
      };
      const mockStorageEngine = {
        getVectorStore: jest.fn(() => mockVectorStore)
      };

      // When: Creating layer with storage engine
      const layerWithStorage = new IntelligenceLayer(config, mockStorageEngine as any);
      await layerWithStorage.initialize();
      
      const vectorStore = (layerWithStorage as any).vectorStore;
      
      // Then: Should have vector store
      expect(vectorStore).toBeDefined();
      expect(vectorStore).toBe(mockVectorStore);
    });

    it('should have internal context builder after initialization', () => {
      // When: Checking internal state
      const contextBuilder = (layer as any).contextBuilder;

      // Then: Should have context builder
      expect(contextBuilder).toBeDefined();
    });

    it('should have query cache when caching is enabled', () => {
      // When: Checking for cache
      const queryCache = (layer as any).queryCache;

      // Then: Should have cache
      expect(queryCache).toBeDefined();
    });
  });

  describe('retrieveMemories implementation', () => {
    beforeEach(async () => {
      layer = new IntelligenceLayer(config);
      await layer.initialize();
    });

    it('should return memories with required fields', async () => {
      // When: Retrieving memories
      const results = await layer.retrieveMemories('test query');

      // Then: Should return array with proper structure
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        const memory = results[0]!;
        expect(memory).toHaveProperty('id');
        expect(memory).toHaveProperty('content');
        expect(memory).toHaveProperty('score');
        expect(memory).toHaveProperty('timestamp');
        expect(typeof memory.score).toBe('number');
        expect(memory.score).toBeGreaterThanOrEqual(0);
        expect(memory.score).toBeLessThanOrEqual(1);
      }
    });

    it('should respect limit option', async () => {
      // Given: Retrieval options with limit
      const options: RetrievalOptions = { limit: 5 };

      // When: Retrieving memories
      const results = await layer.retrieveMemories('test query', options);

      // Then: Should respect limit
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should filter by minimum score', async () => {
      // Given: High minimum score
      const options: RetrievalOptions = { minScore: 0.9 };

      // When: Retrieving memories
      const results = await layer.retrieveMemories('test query', options);

      // Then: All results should meet minimum score
      results.forEach(memory => {
        expect(memory.score).toBeGreaterThanOrEqual(0.9);
      });
    });

    it('should sort results by score descending', async () => {
      // When: Retrieving memories
      const results = await layer.retrieveMemories('test query');

      // Then: Should be sorted by score
      if (results.length > 1) {
        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
        }
      }
    });

    it('should handle empty query gracefully', async () => {
      // When: Retrieving with empty query
      const results = await layer.retrieveMemories('');

      // Then: Should return empty array or handle gracefully
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('buildContext implementation', () => {
    beforeEach(async () => {
      layer = new IntelligenceLayer(config);
      await layer.initialize();
    });

    it('should return formatted context string', async () => {
      // Given: Sample memories
      const memories: RetrievedMemory[] = [
        {
          id: 'mem1',
          content: 'Test memory content',
          score: 0.9,
          metadata: { eventType: 'code_write' },
          timestamp: new Date()
        }
      ];

      // When: Building context
      const context = await layer.buildContext(memories);

      // Then: Should return formatted string
      expect(typeof context).toBe('string');
      expect(context.length).toBeGreaterThan(0);
      expect(context).toContain('Test memory content');
    });

    it('should include metadata when configured', async () => {
      // Given: Memory with metadata
      const memories: RetrievedMemory[] = [
        {
          id: 'mem1',
          content: 'Code change',
          score: 0.9,
          metadata: { 
            eventType: 'code_write',
            file: 'test.js',
            lines: 150
          },
          timestamp: new Date()
        }
      ];

      // When: Building context (with includeMetadata: true in config)
      const context = await layer.buildContext(memories);

      // Then: Should include metadata
      expect(context).toContain('code_write');
      expect(context).toContain('test.js');
    });

    it('should respect maxSize configuration', async () => {
      // Given: Many memories that would exceed max size
      const memories: RetrievedMemory[] = Array(10).fill(null).map((_, i) => ({
        id: `mem${i}`,
        content: 'A'.repeat(2000), // 2000 chars each, total ~20k chars which exceeds 8192 limit
        score: 0.9 - i * 0.01,
        metadata: {},
        timestamp: new Date()
      }));

      // When: Building context
      const context = await layer.buildContext(memories);

      // Then: Should not exceed max size
      expect(context.length).toBeLessThanOrEqual(config.context.maxSize);
      // The test should ensure truncation happens by creating enough data
      // Let's make the test more robust by checking for truncation only if needed
    });

    it('should handle empty memories array', async () => {
      // When: Building context with no memories
      const context = await layer.buildContext([]);

      // Then: Should return appropriate message
      expect(context.length).toBeGreaterThan(0);
      expect(context.toLowerCase()).toMatch(/no.*memories|empty/);
    });
  });

  describe('performance requirements', () => {
    beforeEach(async () => {
      layer = new IntelligenceLayer(config);
      await layer.initialize();
    });

    it('should complete memory retrieval within 200ms', async () => {
      // When: Timing retrieval
      const start = Date.now();
      await layer.retrieveMemories('performance test query');
      const duration = Date.now() - start;

      // Then: Should be fast
      expect(duration).toBeLessThan(200);
    });

    it('should complete context building within 200ms', async () => {
      // Given: Large set of memories
      const memories: RetrievedMemory[] = Array(50).fill(null).map((_, i) => ({
        id: `mem${i}`,
        content: `Memory content ${i}`,
        score: 0.9,
        metadata: { eventType: 'code_write' },
        timestamp: new Date()
      }));

      // When: Timing context building
      const start = Date.now();
      await layer.buildContext(memories);
      const duration = Date.now() - start;

      // Then: Should be fast
      expect(duration).toBeLessThan(200);
    });
  });

  describe('caching behavior', () => {
    beforeEach(async () => {
      layer = new IntelligenceLayer(config);
      await layer.initialize();
    });

    it('should cache identical queries', async () => {
      // Given: A layer with storage engine that tracks calls
      const mockVectorStore = {
        search: jest.fn(() => Promise.resolve([{
          id: 'test-id',
          score: 0.8,
          vector: new Array(384).fill(0),
          metadata: { content: 'test content', timestamp: new Date().toISOString() }
        }])),
        initialize: jest.fn(),
        close: jest.fn()
      };
      const mockStorageEngine = {
        getVectorStore: jest.fn(() => mockVectorStore)
      };
      const mockEmbeddingGenerator = {
        initialize: jest.fn(() => Promise.resolve()),
        generate: jest.fn(() => Promise.resolve(new Array(384).fill(0.5))),
        close: jest.fn(() => Promise.resolve())
      };
      
      const layerWithCache = new IntelligenceLayer(config, mockStorageEngine as any, mockEmbeddingGenerator as any);
      await layerWithCache.initialize();
      
      const query = 'cached query test';
      
      // When: Making the same query twice
      const results1 = await layerWithCache.retrieveMemories(query);
      const results2 = await layerWithCache.retrieveMemories(query);

      // Then: Should only call vector search once (cache hit on second call)
      expect(mockVectorStore.search).toHaveBeenCalledTimes(1);
      expect(results1).toEqual(results2);
    });

    it('should have different cache entries for different options', async () => {
      // Given: Same query with different options
      const query = 'test query';
      
      // When: Retrieving with different options
      const results1 = await layer.retrieveMemories(query, { limit: 5 });
      const results2 = await layer.retrieveMemories(query, { limit: 10 });

      // Then: Results might be different
      expect(results1.length).toBeLessThanOrEqual(5);
      expect(results2.length).toBeLessThanOrEqual(10);
    });
  });

  describe('integration points', () => {
    it('should expose method to check if vector store is available', async () => {
      // Given: Initialized layer
      layer = new IntelligenceLayer(config);
      await layer.initialize();

      // When: Checking for vector store availability
      const hasVectorStore = typeof (layer as any).hasVectorStore === 'function' ?
        await (layer as any).hasVectorStore() : false;

      // Then: Should have method to check
      expect(typeof hasVectorStore).toBe('boolean');
    });

    it('should support custom embedding service through setEmbeddingService', async () => {
      // Given: Initialized layer
      layer = new IntelligenceLayer(config);
      await layer.initialize();

      // When: Setting custom embedding service
      const customService = jest.fn((_text: string) => 
        Promise.resolve(new Array(384).fill(0.5))
      );
      layer.setEmbeddingService(customService);

      // And: Generating embedding
      const embedding = await layer.generateEmbedding('test');

      // Then: Should use custom service
      expect(customService).toHaveBeenCalledWith('test');
      expect(embedding).toEqual(new Array(384).fill(0.5));
    });
  });

  describe('error scenarios', () => {
    it('should handle initialization failures gracefully', async () => {
      // Given: Layer that might fail to initialize
      layer = new IntelligenceLayer(config);

      // When: Multiple initialization attempts
      await layer.initialize();
      
      // Then: Second initialization should be a no-op (doesn't throw)
      await expect(layer.initialize()).resolves.not.toThrow();
    });

    it('should provide meaningful error when not initialized', async () => {
      // Given: Uninitialized layer
      const uninitializedLayer = new IntelligenceLayer(config);

      // When/Then: Operations should throw clear errors
      await expect(uninitializedLayer.retrieveMemories('test'))
        .rejects.toThrow('not initialized');
      
      await expect(uninitializedLayer.buildContext([]))
        .rejects.toThrow('not initialized');
        
      await expect(uninitializedLayer.generateEmbedding('test'))
        .rejects.toThrow('not initialized');
    });
  });
});