import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { IntelligenceLayer, RetrievalOptions, RetrievedMemory } from "../../src/intelligence/layer.js";
import { ContextBuilder } from "../../src/intelligence/context-builder.js";
import { EmbeddingGenerator } from "../../src/intelligence/embeddings.js";
import type { Config } from "../../src/config/index.js";
import type { StorageEngine } from "../../src/storage/engine.js";
import type { VectorStore } from "../../src/storage/vector-store.js";

// Mock logger
jest.mock("../../src/utils/logger.js", () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  })
}));

// Mock ContextBuilder
jest.mock("../../src/intelligence/context-builder.js");

// Mock EmbeddingGenerator  
jest.mock("../../src/intelligence/embedding-generator.js");

describe('IntelligenceLayer - Failing Tests for TDD', () => {
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

  describe('constructor with dependencies', () => {
    it('should accept StorageEngine as second parameter', () => {
      // Given: Mock storage engine
      const mockStorageEngine = {
        getVectorStore: jest.fn(),
        getMemory: jest.fn(),
        queryMemories: jest.fn()
      } as unknown as StorageEngine;

      // When: Creating layer with storage engine
      // @ts-expect-error - Constructor doesn't accept second parameter yet
      layer = new IntelligenceLayer(config, mockStorageEngine);

      // Then: Should store the storage engine
      expect((layer as any).storageEngine).toBe(mockStorageEngine);
    });

    it('should accept EmbeddingGenerator as third parameter', () => {
      // Given: Mock components
      const mockStorageEngine = {} as StorageEngine;
      const mockEmbeddingGenerator = {
        generate: jest.fn(),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      // When: Creating layer with all dependencies
      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);

      // Then: Should store the embedding generator
      expect((layer as any).embeddingGenerator).toBe(mockEmbeddingGenerator);
    });
  });

  describe('initialization with dependencies', () => {
    it('should initialize vector store from storage engine', async () => {
      // Given: Storage engine with vector store
      const mockVectorStore = {
        search: jest.fn(),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as VectorStore;

      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(mockVectorStore)
      } as unknown as StorageEngine;

      // @ts-expect-error - Constructor doesn't accept second parameter yet
      layer = new IntelligenceLayer(config, mockStorageEngine);

      // When: Initializing
      await layer.initialize();

      // Then: Should get vector store from storage engine
      expect(mockStorageEngine.getVectorStore).toHaveBeenCalled();
      expect((layer as any).vectorStore).toBe(mockVectorStore);
    });

    it('should initialize embedding generator', async () => {
      // Given: Embedding generator
      const mockEmbeddingGenerator = {
        generate: jest.fn(),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, {}, mockEmbeddingGenerator);

      // When: Initializing
      await layer.initialize();

      // Then: Should initialize embedding generator
      expect(mockEmbeddingGenerator.initialize).toHaveBeenCalled();
    });

    it('should create ContextBuilder with config', async () => {
      // Given: Layer with config
      layer = new IntelligenceLayer(config);

      // When: Initializing
      await layer.initialize();

      // Then: Should create context builder
      expect((layer as any).contextBuilder).toBeDefined();
      expect(ContextBuilder).toHaveBeenCalledWith({
        format: 'markdown',
        maxSize: config.context.maxSize,
        includeMetadata: config.context.includeMetadata,
        deduplicateThreshold: 0.95
      });
    });
  });

  describe('retrieveMemories with vector search', () => {
    it('should generate embedding for query', async () => {
      // Given: Layer with embedding generator
      const mockEmbedding = new Array(384).fill(0.5);
      const mockEmbeddingGenerator = {
        generate: jest.fn().mockResolvedValue(mockEmbedding),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      const mockVectorStore = {
        search: jest.fn().mockResolvedValue([]),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as VectorStore;

      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(mockVectorStore)
      } as unknown as StorageEngine;

      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // When: Retrieving memories
      await layer.retrieveMemories('test query');

      // Then: Should generate embedding for query
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith('test query');
    });

    it('should search vector store with generated embedding', async () => {
      // Given: Layer with vector store
      const mockEmbedding = new Array(384).fill(0.5);
      const mockVectorStore = {
        search: jest.fn().mockResolvedValue([
          { id: 'mem1', score: 0.9, metadata: {} }
        ]),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as VectorStore;

      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(mockVectorStore),
        getMemory: jest.fn().mockResolvedValue({
          id: 'mem1',
          content: 'Test memory',
          eventType: 'code_write',
          metadata: {},
          timestamp: new Date(),
          sessionId: 'test-session'
        })
      } as unknown as StorageEngine;

      const mockEmbeddingGenerator = {
        generate: jest.fn().mockResolvedValue(mockEmbedding),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // When: Retrieving memories
      const results = await layer.retrieveMemories('test query');

      // Then: Should search with embedding
      expect(mockVectorStore.search).toHaveBeenCalledWith(mockEmbedding, {
        k: config.retrieval.topK,
        threshold: config.retrieval.minScore
      });

      // And: Should return formatted memories
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'mem1',
        content: 'Test memory',
        score: 0.9
      });
    });

    it('should apply retrieval options to vector search', async () => {
      // Given: Layer with vector store
      const mockVectorStore = {
        search: jest.fn().mockResolvedValue([]),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as VectorStore;

      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(mockVectorStore)
      } as unknown as StorageEngine;

      const mockEmbeddingGenerator = {
        generate: jest.fn().mockResolvedValue(new Array(384).fill(0)),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // When: Retrieving with custom options
      const options: RetrievalOptions = {
        limit: 5,
        filters: { eventType: 'code_write' },
        minScore: 0.7
      };
      await layer.retrieveMemories('query', options);

      // Then: Should pass options to vector search
      expect(mockVectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        {
          k: 5,
          filter: { eventType: 'code_write' },
          threshold: 0.7
        }
      );
    });
  });

  describe('SQL fallback when vector store unavailable', () => {
    it('should use queryMemories when vector store is null', async () => {
      // Given: Storage engine without vector store
      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(null),
        queryMemories: jest.fn().mockResolvedValue([
          {
            id: 'sql1',
            content: 'test query related content',
            eventType: 'code_write',
            metadata: {},
            timestamp: new Date(),
            sessionId: 'test-session'
          }
        ])
      } as unknown as StorageEngine;

      // @ts-expect-error - Constructor doesn't accept second parameter yet
      layer = new IntelligenceLayer(config, mockStorageEngine);
      await layer.initialize();

      // When: Retrieving memories
      const results = await layer.retrieveMemories('test query');

      // Then: Should query SQL
      expect(mockStorageEngine.queryMemories).toHaveBeenCalledWith({
        limit: config.retrieval.topK,
        orderBy: 'timestamp',
        orderDirection: 'DESC'
      });

      // And: Should calculate text similarity scores
      expect(results).toHaveLength(1);
      expect(results[0]!.score).toBeGreaterThan(0);
    });

    it('should calculate text similarity scores for SQL results', async () => {
      // Given: Storage engine with SQL results
      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(null),
        queryMemories: jest.fn().mockResolvedValue([
          {
            id: 'sql1',
            content: 'test query exact match',
            eventType: 'code_write',
            metadata: {},
            timestamp: new Date(),
            sessionId: 'test'
          },
          {
            id: 'sql2',
            content: 'completely unrelated content',
            eventType: 'code_write',
            metadata: {},
            timestamp: new Date(),
            sessionId: 'test'
          }
        ])
      } as unknown as StorageEngine;

      // @ts-expect-error - Constructor doesn't accept second parameter yet
      layer = new IntelligenceLayer(config, mockStorageEngine);
      await layer.initialize();

      // When: Retrieving memories
      const results = await layer.retrieveMemories('test query');

      // Then: Should have different scores based on similarity
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
      expect(results[0]!.id).toBe('sql1');
    });
  });

  describe('buildContext with ContextBuilder', () => {
    it('should use ContextBuilder to format memories', async () => {
      // Given: Mock context builder
      const mockContextBuilder = {
        build: jest.fn().mockReturnValue('# Retrieved Context\n\nMemory 1...')
      };
      (ContextBuilder as jest.MockedClass<typeof ContextBuilder>).mockImplementation(
        () => mockContextBuilder as any
      );

      layer = new IntelligenceLayer(config);
      await layer.initialize();

      const memories: RetrievedMemory[] = [
        {
          id: 'mem1',
          content: 'Test memory',
          score: 0.9,
          metadata: { eventType: 'code_write' },
          timestamp: new Date()
        }
      ];

      // When: Building context
      const context = await layer.buildContext(memories);

      // Then: Should use context builder
      expect(mockContextBuilder.build).toHaveBeenCalledWith(memories);
      expect(context).toBe('# Retrieved Context\n\nMemory 1...');
    });
  });

  describe('query caching', () => {
    it('should cache query results when cache enabled', async () => {
      // Given: Layer with caching enabled
      const mockVectorStore = {
        search: jest.fn().mockResolvedValue([
          { id: 'mem1', score: 0.9, metadata: {} }
        ]),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as VectorStore;

      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(mockVectorStore),
        getMemory: jest.fn().mockResolvedValue({
          id: 'mem1',
          content: 'Cached memory',
          eventType: 'code_write',
          metadata: {},
          timestamp: new Date(),
          sessionId: 'test'
        })
      } as unknown as StorageEngine;

      const mockEmbeddingGenerator = {
        generate: jest.fn().mockResolvedValue(new Array(384).fill(0)),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // When: Making same query twice
      const query = 'test query';
      const results1 = await layer.retrieveMemories(query);
      const results2 = await layer.retrieveMemories(query);

      // Then: Should only search once
      expect(mockVectorStore.search).toHaveBeenCalledTimes(1);
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledTimes(1);
      expect(results1).toEqual(results2);
    });

    it('should have separate cache entries for different options', async () => {
      // Given: Layer with caching
      const mockVectorStore = {
        search: jest.fn().mockResolvedValue([]),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as VectorStore;

      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(mockVectorStore)
      } as unknown as StorageEngine;

      const mockEmbeddingGenerator = {
        generate: jest.fn().mockResolvedValue(new Array(384).fill(0)),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // When: Same query with different options
      await layer.retrieveMemories('query', { limit: 5 });
      await layer.retrieveMemories('query', { limit: 10 });

      // Then: Should make separate searches
      expect(mockVectorStore.search).toHaveBeenCalledTimes(2);
    });
  });

  describe('performance requirements', () => {
    it('should complete retrieval within 200ms', async () => {
      // Given: Layer with fast mocks
      const mockVectorStore = {
        search: jest.fn().mockImplementation(() => {
          // Simulate some processing time
          return new Promise(resolve => setTimeout(() => resolve([]), 50));
        }),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as VectorStore;

      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(mockVectorStore)
      } as unknown as StorageEngine;

      const mockEmbeddingGenerator = {
        generate: jest.fn().mockImplementation(() => {
          // Simulate embedding generation time
          return new Promise(resolve => 
            setTimeout(() => resolve(new Array(384).fill(0)), 30)
          );
        }),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // When: Measuring retrieval time
      const startTime = Date.now();
      await layer.retrieveMemories('test query');
      const duration = Date.now() - startTime;

      // Then: Should complete within 200ms
      expect(duration).toBeLessThan(200);
    });

    it('should complete context building within 200ms', async () => {
      // Given: Layer with many memories
      layer = new IntelligenceLayer(config);
      await layer.initialize();

      const memories: RetrievedMemory[] = Array(100).fill(null).map((_, i) => ({
        id: `mem${i}`,
        content: `Memory content ${i} with some longer text to make it realistic`,
        score: 0.9 - i * 0.001,
        metadata: { eventType: 'code_write', file: `file${i}.js` },
        timestamp: new Date()
      }));

      // When: Measuring context building time
      const startTime = Date.now();
      await layer.buildContext(memories);
      const duration = Date.now() - startTime;

      // Then: Should complete within 200ms
      expect(duration).toBeLessThan(200);
    });
  });

  describe('error handling', () => {
    it('should handle vector store errors gracefully', async () => {
      // Given: Vector store that throws error
      const mockVectorStore = {
        search: jest.fn().mockRejectedValue(new Error('Vector store error')),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as VectorStore;

      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(mockVectorStore),
        queryMemories: jest.fn().mockResolvedValue([]) // Fallback should work
      } as unknown as StorageEngine;

      const mockEmbeddingGenerator = {
        generate: jest.fn().mockResolvedValue(new Array(384).fill(0)),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // When: Retrieving memories
      const results = await layer.retrieveMemories('test query');

      // Then: Should fall back to SQL
      expect(mockStorageEngine.queryMemories).toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('should handle embedding generation errors', async () => {
      // Given: Embedding generator that fails
      const mockVectorStore = {
        search: jest.fn(),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as VectorStore;

      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(mockVectorStore),
        queryMemories: jest.fn().mockResolvedValue([])
      } as unknown as StorageEngine;

      const mockEmbeddingGenerator = {
        generate: jest.fn().mockRejectedValue(new Error('Model loading failed')),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // When: Retrieving memories
      const results = await layer.retrieveMemories('test query');

      // Then: Should fall back gracefully
      expect(results).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('should close all components on close', async () => {
      // Given: Layer with all components
      const mockVectorStore = {
        search: jest.fn().mockResolvedValue([]),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as VectorStore;

      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(mockVectorStore)
      } as unknown as StorageEngine;

      const mockEmbeddingGenerator = {
        generate: jest.fn(),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      const mockContextBuilder = {
        build: jest.fn(),
        close: jest.fn()
      };
      (ContextBuilder as jest.MockedClass<typeof ContextBuilder>).mockImplementation(
        () => mockContextBuilder as any
      );

      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // When: Closing layer
      await layer.close();

      // Then: Should close all components
      expect(mockVectorStore.close).toHaveBeenCalled();
      expect(mockEmbeddingGenerator.close).toHaveBeenCalled();
      expect(mockContextBuilder.close).toHaveBeenCalled();
    });

    it('should clear cache on close', async () => {
      // Given: Layer with cached queries
      const mockVectorStore = {
        search: jest.fn().mockResolvedValue([]),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as VectorStore;

      const mockStorageEngine = {
        getVectorStore: jest.fn().mockResolvedValue(mockVectorStore)
      } as unknown as StorageEngine;

      const mockEmbeddingGenerator = {
        generate: jest.fn().mockResolvedValue(new Array(384).fill(0)),
        initialize: jest.fn(),
        close: jest.fn()
      } as unknown as EmbeddingGenerator;

      // @ts-expect-error - Constructor doesn't accept these parameters yet
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // Cache a query
      await layer.retrieveMemories('cached query');
      expect(mockVectorStore.search).toHaveBeenCalledTimes(1);

      // When: Closing and reinitializing
      await layer.close();
      await layer.initialize();

      // Then: Cache should be cleared
      await layer.retrieveMemories('cached query');
      expect(mockVectorStore.search).toHaveBeenCalledTimes(2);
    });
  });
});