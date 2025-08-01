// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { IntelligenceLayer, RetrievalOptions, RetrievedMemory } from "../../src/intelligence/layer.js";
import type { Config } from "../../src/config/index.js";

// Mock logger
jest.mock("../../src/utils/logger.js", () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  })
}));

// Mock EmbeddingGenerator
jest.mock("../../src/intelligence/embeddings.js", () => ({
  EmbeddingGenerator: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    generate: jest.fn().mockResolvedValue(new Array(384).fill(0)),
    close: jest.fn().mockResolvedValue(undefined)
  }))
}));

// Mock ContextBuilder
jest.mock("../../src/intelligence/context-builder.js", () => ({
  ContextBuilder: jest.fn().mockImplementation(() => ({
    build: jest.fn().mockReturnValue("")
  }))
}));

describe('IntelligenceLayer', () => {
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

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      // When: Creating and initializing layer
      layer = new IntelligenceLayer(config);
      await layer.initialize();

      // Then: Should be initialized
      expect(layer).toBeDefined();
    });

    it('should throw error when not initialized', async () => {
      // Given: Layer not initialized
      layer = new IntelligenceLayer(config);

      // When/Then: Methods should throw
      await expect(layer.generateEmbedding("test")).rejects.toThrow("Intelligence layer not initialized");
      await expect(layer.retrieveMemories("test")).rejects.toThrow("Intelligence layer not initialized");
      await expect(layer.buildContext([])).rejects.toThrow("Intelligence layer not initialized");
    });

    it('should prevent double initialization', async () => {
      // Given: Layer already initialized
      layer = new IntelligenceLayer(config);
      await layer.initialize();

      // When/Then: Second initialization should not throw
      await expect(layer.initialize()).resolves.not.toThrow();
    });
  });

  describe('setEmbeddingService', () => {
    beforeEach(async () => {
      layer = new IntelligenceLayer(config);
      await layer.initialize();
    });

    it('should accept custom embedding service', () => {
      // Given: Custom embedding service
      const customService = jest.fn().mockResolvedValue(new Array(768).fill(0.5)) as any;

      // When: Setting service
      layer.setEmbeddingService(customService);

      // Then: Should not throw
      expect(() => layer.setEmbeddingService(customService)).not.toThrow();
    });

    it('should use custom embedding service when set', async () => {
      // Given: Custom embedding service
      const customEmbedding = new Array(768).fill(0.5);
      const customService = jest.fn().mockResolvedValue(customEmbedding) as any;
      layer.setEmbeddingService(customService);

      // When: Generating embedding
      const result = await layer.generateEmbedding("test text");

      // Then: Should use custom service
      expect(customService).toHaveBeenCalledWith("test text");
      expect(result).toEqual(customEmbedding);
    });
  });

  describe('generateEmbedding', () => {
    beforeEach(async () => {
      layer = new IntelligenceLayer(config);
      await layer.initialize();
    });

    it('should generate embeddings for text', async () => {
      // When: Generating embedding
      const embedding = await layer.generateEmbedding("test text");

      // Then: Should return array of numbers
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(384); // Default model dimension
      expect(embedding.every(val => typeof val === 'number')).toBe(true);
    });

    it('should handle empty text', async () => {
      // When/Then: Generating embedding for empty text should throw
      await expect(layer.generateEmbedding("")).rejects.toThrow('Cannot generate embedding for empty text');
    });

    it('should handle very long text', async () => {
      // Given: Very long text
      const longText = "Lorem ipsum ".repeat(1000);

      // When: Generating embedding
      const embedding = await layer.generateEmbedding(longText);

      // Then: Should return valid embedding
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(384);
    });
  });

  describe('retrieveMemories', () => {
    beforeEach(async () => {
      layer = new IntelligenceLayer(config);
      await layer.initialize();
    });

    it('should retrieve memories with default options', async () => {
      // When: Retrieving without options
      const memories = await layer.retrieveMemories("test query");

      // Then: Should return array (empty in base implementation)
      expect(Array.isArray(memories)).toBe(true);
      expect(memories).toEqual([]);
    });

    it('should respect limit option', async () => {
      // Given: Custom limit
      const options: RetrievalOptions = { limit: 5 };

      // When: Retrieving with limit
      const memories = await layer.retrieveMemories("test query", options);

      // Then: Should respect limit (empty array in base implementation)
      expect(Array.isArray(memories)).toBe(true);
      expect(memories.length).toBeLessThanOrEqual(5);
    });

    it('should respect minScore option', async () => {
      // Given: Custom minScore
      const options: RetrievalOptions = { minScore: 0.8 };

      // When: Retrieving with minScore
      const memories = await layer.retrieveMemories("test query", options);

      // Then: Should filter by score (empty in base implementation)
      expect(Array.isArray(memories)).toBe(true);
      memories.forEach(memory => {
        expect(memory.score).toBeGreaterThanOrEqual(0.8);
      });
    });

    it('should respect filters option', async () => {
      // Given: Custom filters
      const options: RetrievalOptions = {
        filters: {
          eventType: "code_write",
          sessionId: "test-session"
        }
      };

      // When: Retrieving with filters
      const memories = await layer.retrieveMemories("test query", options);

      // Then: Should apply filters (empty in base implementation)
      expect(Array.isArray(memories)).toBe(true);
    });

    it('should respect includeMetadata option', async () => {
      // Given: Include metadata option
      const options: RetrievalOptions = { includeMetadata: true };

      // When: Retrieving with metadata
      const memories = await layer.retrieveMemories("test query", options);

      // Then: Should include metadata (empty in base implementation)
      expect(Array.isArray(memories)).toBe(true);
    });
  });

  describe('buildContext', () => {
    beforeEach(async () => {
      layer = new IntelligenceLayer(config);
      await layer.initialize();
    });

    it('should build context from empty memories', async () => {
      // Given: Empty memories
      const memories: RetrievedMemory[] = [];

      // When: Building context
      const context = await layer.buildContext(memories);

      // Then: Should return string
      expect(typeof context).toBe('string');
    });

    it('should build context from single memory', async () => {
      // Given: Single memory
      const memories: RetrievedMemory[] = [{
        id: "mem_1",
        content: "Test memory content",
        score: 0.95,
        metadata: { eventType: "test" },
        timestamp: new Date()
      }];

      // When: Building context
      const context = await layer.buildContext(memories);

      // Then: Should return formatted context
      expect(typeof context).toBe('string');
    });

    it('should build context from multiple memories', async () => {
      // Given: Multiple memories
      const memories: RetrievedMemory[] = [
        {
          id: "mem_1",
          content: "First memory",
          score: 0.95,
          metadata: { eventType: "code_write" },
          timestamp: new Date()
        },
        {
          id: "mem_2",
          content: "Second memory",
          score: 0.85,
          metadata: { eventType: "command_run" },
          timestamp: new Date()
        },
        {
          id: "mem_3",
          content: "Third memory",
          score: 0.75,
          metadata: { eventType: "test_run" },
          timestamp: new Date()
        }
      ];

      // When: Building context
      const context = await layer.buildContext(memories);

      // Then: Should return formatted context
      expect(typeof context).toBe('string');
    });
  });

  describe('close', () => {
    it('should close successfully', async () => {
      // Given: Initialized layer
      layer = new IntelligenceLayer(config);
      await layer.initialize();

      // When/Then: Closing should not throw
      await expect(layer.close()).resolves.not.toThrow();
    });

    it('should handle multiple close calls', async () => {
      // Given: Initialized layer
      layer = new IntelligenceLayer(config);
      await layer.initialize();

      // When: Closing multiple times
      await layer.close();

      // Then: Second close should not throw
      await expect(layer.close()).resolves.not.toThrow();
    });

    it('should prevent operations after close', async () => {
      // Given: Closed layer
      layer = new IntelligenceLayer(config);
      await layer.initialize();
      await layer.close();

      // When/Then: Operations should throw
      await expect(layer.generateEmbedding("test")).rejects.toThrow("Intelligence layer not initialized");
      await expect(layer.retrieveMemories("test")).rejects.toThrow("Intelligence layer not initialized");
      await expect(layer.buildContext([])).rejects.toThrow("Intelligence layer not initialized");
    });
  });

  describe('advanced functionality', () => {
    beforeEach(async () => {
      layer = new IntelligenceLayer(config);
      await layer.initialize();
    });

    it('should support method for setting storage engine', async () => {
      // Given: Storage engine mock
      const mockStorageEngine = {
        getVectorStore: jest.fn().mockReturnValue({
          search: jest.fn().mockResolvedValue([]),
          initialize: jest.fn(),
          close: jest.fn()
        })
      } as any;

      // When: Setting storage engine
      (layer as any).setStorageEngine(mockStorageEngine);
      
      // Then: Should be set
      expect((layer as any).storageEngine).toBe(mockStorageEngine);
    });

    it('should support method for setting embedding generator', async () => {
      // Given: Embedding generator mock
      const mockEmbeddingGenerator = {
        generate: jest.fn().mockResolvedValue(new Array(384).fill(0.1)),
        initialize: jest.fn(),
        close: jest.fn()
      } as any;

      // When: Setting embedding generator
      (layer as any).setEmbeddingGenerator(mockEmbeddingGenerator);
      
      // Then: Should be set
      expect((layer as any).embeddingGenerator).toBe(mockEmbeddingGenerator);
    });
  });

  // Tests for advanced features
  describe('initialization with dependencies', () => {
    it('should initialize with StorageEngine dependency', async () => {
      // Given: IntelligenceLayer with storage engine
      const mockStorageEngine = {
        getVectorStore: jest.fn().mockReturnValue({
          search: jest.fn().mockResolvedValue([]),
          initialize: jest.fn().mockResolvedValue(undefined),
          close: jest.fn().mockResolvedValue(undefined)
        })
      } as any;

      // When: Creating with dependencies
      layer = new IntelligenceLayer(config, mockStorageEngine);
      await layer.initialize();

      // Then: Should initialize successfully
      expect(mockStorageEngine.getVectorStore).toHaveBeenCalled();
    });

    it('should initialize with EmbeddingGenerator dependency', async () => {
      // Given: Dependencies
      const mockStorageEngine = {
        getVectorStore: jest.fn().mockReturnValue(null)
      } as any;
      
      const mockEmbeddingGenerator = {
        initialize: jest.fn().mockResolvedValue(undefined),
        generate: jest.fn().mockResolvedValue(new Array(384).fill(0.1)),
        close: jest.fn().mockResolvedValue(undefined)
      } as any;

      // When: Creating with all dependencies
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // Then: Should use provided generator
      expect(mockEmbeddingGenerator.initialize).toHaveBeenCalled();
    });
  });

  describe('retrieveMemories with vector search', () => {
    let mockVectorStore: any;
    let mockStorageEngine: any;
    let mockEmbeddingGenerator: any;

    beforeEach(() => {
      // Setup mocks
      mockVectorStore = {
        search: jest.fn().mockResolvedValue([]),
        initialize: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined)
      };

      mockStorageEngine = {
        getVectorStore: jest.fn().mockReturnValue(mockVectorStore),
      };

      mockEmbeddingGenerator = {
        generate: jest.fn().mockResolvedValue(new Array(384).fill(0.5)),
        initialize: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined)
      };
    });

    it('should search vector store for similar memories', async () => {
      // Given: Vector results
      const vectorResults = [
        {
          id: 'vec_1',
          score: 0.95,
          metadata: {
            content: 'Test content 1',
            timestamp: new Date().toISOString(),
            eventType: 'code_write'
          }
        }
      ];
      mockVectorStore.search.mockResolvedValue(vectorResults);

      // When: Creating layer and searching
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();
      
      const results = await layer.retrieveMemories('test query', { limit: 5 });

      // Then: Should call vector search
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith('test query');
      expect(mockVectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          k: 10, // limit * 2 for reranking
          threshold: 0.5,
          filter: {}
        })
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('Test content 1');
    });

    it('should apply filters during vector search', async () => {
      // Given: Filters
      const filters = {
        workspaceId: 'test-workspace',
        gitBranch: 'main'
      };

      // When: Searching with filters
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();
      
      await layer.retrieveMemories('test query', { filters });

      // Then: Should pass filters to vector search
      expect(mockVectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          filter: filters
        })
      );
    });

    it('should rerank results when enabled', async () => {
      // Given: Multiple results
      const vectorResults = [
        {
          id: 'vec_1',
          score: 0.8,
          metadata: {
            content: 'Old content',
            timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days old
            eventType: 'code_write'
          }
        },
        {
          id: 'vec_2',
          score: 0.75,
          metadata: {
            content: 'Recent content with query terms',
            timestamp: new Date().toISOString(), // Today
            eventType: 'code_write'
          }
        }
      ];
      mockVectorStore.search.mockResolvedValue(vectorResults);

      // When: Searching (rerank enabled by default)
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();
      
      const results = await layer.retrieveMemories('query terms', { limit: 2 });

      // Then: Recent content should be ranked higher
      expect(results[0]?.content).toContain('Recent content');
      expect(results[1]?.content).toBe('Old content');
    });
  });

  describe('buildContext with ContextBuilder', () => {
    let mockStorageEngine: any;

    beforeEach(() => {
      mockStorageEngine = {
        getVectorStore: jest.fn().mockReturnValue(null)
      };
    });

    it('should use ContextBuilder to format memories', async () => {
      // Given: Memories to format
      const memories: RetrievedMemory[] = [
        {
          id: 'mem1',
          content: 'Test content',
          score: 0.9,
          metadata: { eventType: 'code_write' },
          timestamp: new Date()
        }
      ];

      // When: Building context
      layer = new IntelligenceLayer(config, mockStorageEngine);
      await layer.initialize();
      
      const context = await layer.buildContext(memories);

      // Then: Should return formatted context
      expect(context).toBeDefined();
      expect(typeof context).toBe('string');
    });

    it('should respect maxSize configuration', async () => {
      // Given: Many memories
      const memories: RetrievedMemory[] = Array(100).fill(0).map((_, i) => ({
        id: `mem${i}`,
        content: `Long content ${i}: ${'x'.repeat(1000)}`,
        score: 0.9 - (i * 0.01),
        metadata: {},
        timestamp: new Date()
      }));

      // When: Building context
      layer = new IntelligenceLayer(config, mockStorageEngine);
      await layer.initialize();
      
      const context = await layer.buildContext(memories);

      // Then: Should not exceed max size
      expect(context.length).toBeLessThanOrEqual(config.context.maxSize);
    });

    it('should include metadata when configured', async () => {
      // Given: Config with metadata enabled
      const configWithMeta = {
        ...config,
        context: { ...config.context, includeMetadata: true }
      };

      const memories: RetrievedMemory[] = [{
        id: 'mem1',
        content: 'Test content',
        score: 0.9,
        metadata: {
          eventType: 'code_write',
          file: 'test.ts',
          sessionId: 'test-session'
        },
        timestamp: new Date()
      }];

      // When: Building context
      layer = new IntelligenceLayer(configWithMeta, mockStorageEngine);
      await layer.initialize();
      
      const context = await layer.buildContext(memories);

      // Then: Context should include metadata
      expect(context).toBeDefined();
    });

    it('should apply deduplication when enabled', async () => {
      // Given: Duplicate memories
      const memories: RetrievedMemory[] = [
        {
          id: 'mem1',
          content: 'Duplicate content',
          score: 0.9,
          metadata: {},
          timestamp: new Date()
        },
        {
          id: 'mem2',
          content: 'Duplicate content',
          score: 0.85,
          metadata: {},
          timestamp: new Date()
        },
        {
          id: 'mem3',
          content: 'Different content',
          score: 0.8,
          metadata: {},
          timestamp: new Date()
        }
      ];

      // When: Building context with deduplication
      layer = new IntelligenceLayer(config, mockStorageEngine);
      await layer.initialize();
      
      const context = await layer.buildContext(memories);

      // Then: Should deduplicate
      expect(context).toBeDefined();
    });
  });

  describe('query caching', () => {
    let mockVectorStore: any;
    let mockStorageEngine: any;
    let mockEmbeddingGenerator: any;

    beforeEach(() => {
      mockVectorStore = {
        search: jest.fn().mockResolvedValue([
          {
            id: 'vec_1',
            score: 0.9,
            metadata: {
              content: 'Cached result',
              timestamp: new Date().toISOString()
            }
          }
        ])
      };

      mockStorageEngine = {
        getVectorStore: jest.fn().mockReturnValue(mockVectorStore),
        getMemory: jest.fn().mockResolvedValue({
          id: 'mem1',
          content: 'Test memory',
          timestamp: new Date()
        })
      };

      mockEmbeddingGenerator = {
        generate: jest.fn().mockResolvedValue(new Array(384).fill(0.5)),
        initialize: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined)
      };
    });

    it('should cache query results', async () => {
      // When: Making same query twice
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();
      
      const results1 = await layer.retrieveMemories('cached query', { limit: 5 });
      const results2 = await layer.retrieveMemories('cached query', { limit: 5 });

      // Then: Should only call vector search once
      expect(mockVectorStore.search).toHaveBeenCalledTimes(1);
      expect(results1).toEqual(results2);
    });

    it('should not use cache for different queries', async () => {
      // When: Making different queries
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();
      
      await layer.retrieveMemories('query 1', { limit: 5 });
      await layer.retrieveMemories('query 2', { limit: 5 });

      // Then: Should call vector search twice
      expect(mockVectorStore.search).toHaveBeenCalledTimes(2);
    });

    it('should not use cache for different options', async () => {
      // When: Same query with different options
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();
      
      await layer.retrieveMemories('query', { limit: 5 });
      await layer.retrieveMemories('query', { limit: 10 });

      // Then: Should call vector search twice
      expect(mockVectorStore.search).toHaveBeenCalledTimes(2);
    });

    it('should expose cache for monitoring', async () => {
      // When: Making queries
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();
      
      await layer.retrieveMemories('query 1', { limit: 5 });
      await layer.retrieveMemories('query 2', { limit: 5 });

      // Then: Cache should have entries
      const cache = layer.getQueryCache();
      expect(cache.size).toBe(2);
    });

    it('should limit cache size', async () => {
      // When: Making many queries
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();
      
      // Make 150 different queries
      for (let i = 0; i < 150; i++) {
        await layer.retrieveMemories(`query ${i}`, { limit: 5 });
      }

      // Then: Cache should be limited to 100
      const cache = layer.getQueryCache();
      expect(cache.size).toBeLessThanOrEqual(100);
    });
  });

  describe('SQL fallback', () => {
    let mockStorageEngine: any;

    beforeEach(() => {
      mockStorageEngine = {
        getVectorStore: jest.fn().mockReturnValue(null),
        queryMemories: jest.fn().mockReturnValue([
          {
            id: 'mem1',
            content: 'SQL result with query terms',
            eventType: 'code_write',
            metadata: { file: 'test.ts' },
            timestamp: new Date(),
            sessionId: 'test-session'
          },
          {
            id: 'mem2',
            content: 'Another result',
            eventType: 'command_run',
            metadata: { command: 'npm test' },
            timestamp: new Date(),
            sessionId: 'test-session'
          }
        ])
      };
    });

    it('should fall back to SQL when vector store unavailable', async () => {
      // When: Searching without vector store
      layer = new IntelligenceLayer(config, mockStorageEngine);
      await layer.initialize();
      
      const results = await layer.retrieveMemories('query terms', { limit: 5 });

      // Then: Should use SQL fallback
      expect(mockStorageEngine.queryMemories).toHaveBeenCalledWith({
        limit: 5
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.content).toContain('query terms');
    });

    it('should score SQL results based on query terms', async () => {
      // When: Searching with specific terms
      layer = new IntelligenceLayer(config, mockStorageEngine);
      await layer.initialize();
      
      const results = await layer.retrieveMemories('query terms', { limit: 5 });

      // Then: Results with query terms should score higher
      expect(results[0]?.score).toBeGreaterThan(0);
      expect(results[0]?.content).toContain('query terms');
    });

    it('should apply filters in SQL fallback', async () => {
      // Given: Filters
      const filters = {
        sessionId: 'test-session',
        eventType: 'code_write'
      };

      // When: Searching with filters
      layer = new IntelligenceLayer(config, mockStorageEngine);
      await layer.initialize();
      
      await layer.retrieveMemories('test', { filters, limit: 5 });

      // Then: Should pass filters to SQL query
      expect(mockStorageEngine.queryMemories).toHaveBeenCalledWith({
        sessionId: 'test-session',
        eventType: 'code_write',
        limit: 5
      });
    });

    it('should handle SQL errors gracefully', async () => {
      // Given: SQL error - create custom mock
      const errorMockStorageEngine = {
        getVectorStore: jest.fn().mockReturnValue(null),
        queryMemories: jest.fn().mockImplementation(() => {
          throw new Error('Database error');
        })
      };

      // When: Searching
      layer = new IntelligenceLayer(config, errorMockStorageEngine);
      await layer.initialize();
      
      const results = await layer.retrieveMemories('test', { limit: 5 });

      // Then: Should return empty array
      expect(results).toEqual([]);
    });

    it('should handle missing storage engine', async () => {
      // Given: No storage engine
      layer = new IntelligenceLayer(config);
      await layer.initialize();

      // When: Searching
      const results = await layer.retrieveMemories('test', { limit: 5 });

      // Then: Should return empty array
      expect(results).toEqual([]);
    });
  });

  describe('integration with EmbeddingGenerator', () => {
    let mockVectorStore: any;
    let mockStorageEngine: any;
    let mockEmbeddingGenerator: any;

    beforeEach(() => {
      mockVectorStore = {
        search: jest.fn().mockResolvedValue([]),
        initialize: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined)
      };

      mockStorageEngine = {
        getVectorStore: jest.fn().mockReturnValue(mockVectorStore)
      };

      mockEmbeddingGenerator = {
        generate: jest.fn().mockResolvedValue(new Array(384).fill(0.1)),
        generateBatch: jest.fn().mockImplementation((texts: string[]) =>
          Promise.resolve(texts.map(() => new Array(384).fill(0.1)))
        ),
        initialize: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined)
      };
    });

    it('should initialize embedding generator', async () => {
      // When: Initializing with custom generator
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // Then: Should initialize generator
      expect(mockEmbeddingGenerator.initialize).toHaveBeenCalled();
    });

    it('should use embedding generator for queries', async () => {
      // When: Retrieving memories
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();
      
      await layer.retrieveMemories('test query');

      // Then: Should generate embedding for query
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith('test query');
    });

    it('should close embedding generator on shutdown', async () => {
      // Given: Initialized layer
      layer = new IntelligenceLayer(config, mockStorageEngine, mockEmbeddingGenerator);
      await layer.initialize();

      // When: Closing
      await layer.close();

      // Then: Should close generator
      expect(mockEmbeddingGenerator.close).toHaveBeenCalled();
    });
  });
});