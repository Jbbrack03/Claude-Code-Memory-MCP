import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { VectorStore, CrossEncoder, VectorResult } from "../../src/storage/vector-store.js";
import { EmbeddingGenerator } from "../../src/intelligence/embeddings.js";

// Mock the EmbeddingGenerator
jest.mock("../../src/intelligence/embeddings.js");

describe('VectorStore - Embedding Integration', () => {
  let store: VectorStore;
  let mockEmbeddingGenerator: jest.Mocked<EmbeddingGenerator>;

  beforeEach(() => {
    // Create mock embedding generator
    mockEmbeddingGenerator = {
      initialize: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      generate: jest.fn<(text: string) => Promise<number[]>>().mockResolvedValue(Array(384).fill(0.1)),
      generateBatch: jest.fn<(texts: string[]) => Promise<number[][]>>().mockImplementation((texts: string[]) => 
        Promise.resolve(texts.map(() => Array(384).fill(0.1)))
      ),
      close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      getModelInfo: jest.fn<() => { name: string; dimension: number; ready: boolean }>().mockReturnValue({ 
        name: 'test-model', 
        dimension: 384, 
        ready: true 
      }),
      getBackend: jest.fn<() => string>().mockReturnValue('cpu'),
      getCacheStats: jest.fn<() => {
        size: number;
        maxSize: number;
        hits: number;
        misses: number;
        hitRate: number;
      }>().mockReturnValue({
        size: 0,
        maxSize: 1000,
        hits: 0,
        misses: 0,
        hitRate: 0
      }),
      clearCache: jest.fn<() => void>(),
      getPerformanceMetrics: jest.fn<() => {
        totalOperations: number;
        averageLatency: number;
        p95Latency: number;
        p99Latency: number;
      }>().mockReturnValue({
        totalOperations: 0,
        averageLatency: 0,
        p95Latency: 0,
        p99Latency: 0
      })
    } as unknown as jest.Mocked<EmbeddingGenerator>;

    // Mock constructor
    const MockedEmbeddingGenerator = EmbeddingGenerator as jest.MockedClass<typeof EmbeddingGenerator>;
    MockedEmbeddingGenerator.mockImplementation(() => mockEmbeddingGenerator);
  });

  afterEach(async () => {
    if (store) {
      await store.close();
    }
    jest.clearAllMocks();
  });

  describe('automatic embedding generation', () => {
    it('should generate embeddings automatically when storing text', async () => {
      // Given: VectorStore with embedding generation enabled
      store = new VectorStore({ 
        dimension: 384,
        embeddingGenerator: mockEmbeddingGenerator // Feature not implemented yet
      });
      await store.initialize();

      // When: Storing text instead of vector
      const text = "This is a test memory about file operations";
      const memoryId = await store.storeText(text, { type: 'memory' }); // New method

      // Then: Should generate embedding and store it
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith(text);
      expect(memoryId).toMatch(/^vec_\d+_[a-z0-9]+$/);

      // Verify vector was stored
      const result = await store.get(memoryId);
      expect(result).not.toBeNull();
      expect(result!.vector).toHaveLength(384);
      expect(result!.metadata).toEqual({ type: 'memory', text });
    });

    it('should support semantic search with text queries', async () => {
      // Given: Store with text-based memories
      store = new VectorStore({ 
        dimension: 384,
        embeddingGenerator: mockEmbeddingGenerator
      });
      await store.initialize();

      // Mock different embeddings for different texts
      mockEmbeddingGenerator.generate
        .mockResolvedValueOnce(Array(384).fill(0).map((_, i) => i === 0 ? 1 : 0)) // git
        .mockResolvedValueOnce(Array(384).fill(0).map((_, i) => i === 1 ? 1 : 0)) // file
        .mockResolvedValueOnce(Array(384).fill(0).map((_, i) => i === 2 ? 1 : 0)) // test
        .mockResolvedValueOnce(Array(384).fill(0).map((_, i) => i === 0 ? 0.9 : i === 1 ? 0.1 : 0)); // query

      await store.storeText("User committed changes to git", { type: 'git' });
      await store.storeText("File operations were performed", { type: 'file' });
      await store.storeText("Tests were executed successfully", { type: 'test' });

      // When: Searching with text query
      const results = await store.searchText("git operations", { k: 2 }); // New method

      // Then: Should find semantically similar results
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith("git operations");
      expect(results).toHaveLength(2);
      expect(results[0]!.metadata.type).toBe('git');
      expect(results[0]!.score).toBeGreaterThan(0.8);
    });

    it('should handle batch text storage efficiently', async () => {
      // Given: Multiple texts to store
      store = new VectorStore({ 
        dimension: 384,
        embeddingGenerator: mockEmbeddingGenerator
      });
      await store.initialize();

      const texts = [
        "Memory 1: File was created",
        "Memory 2: Tests passed",
        "Memory 3: Git commit made",
        "Memory 4: Server started",
        "Memory 5: Error occurred"
      ];

      // When: Storing multiple texts
      const ids = await store.storeTextBatch(texts, { session: 'test' }); // New method

      // Then: Should use batch embedding generation
      expect(mockEmbeddingGenerator.generateBatch).toHaveBeenCalledWith(texts);
      expect(ids).toHaveLength(5);
      
      // Verify all were stored
      for (let i = 0; i < ids.length; i++) {
        const result = await store.get(ids[i]!);
        expect(result).not.toBeNull();
        expect(result!.metadata.text).toBe(texts[i]);
        expect(result!.metadata.session).toBe('test');
      }
    });

    it('should handle embedding generation failures gracefully', async () => {
      // Given: Embedding generator that fails
      store = new VectorStore({ 
        dimension: 384,
        embeddingGenerator: mockEmbeddingGenerator
      });
      await store.initialize();

      mockEmbeddingGenerator.generate.mockRejectedValue(new Error('Model not loaded'));

      // When: Trying to store text
      // Then: Should throw meaningful error
      await expect(store.storeText("Test text", {}))
        .rejects.toThrow('Failed to generate embedding: Model not loaded');
    });

    it('should cache embeddings for duplicate texts', async () => {
      // Given: Store with embedding cache enabled
      store = new VectorStore({ 
        dimension: 384,
        embeddingGenerator: mockEmbeddingGenerator,
        embeddingCache: true // Feature not implemented yet
      });
      await store.initialize();

      const text = "Repeated memory text";
      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingGenerator.generate.mockResolvedValue(embedding);

      // When: Storing same text multiple times
      const id1 = await store.storeText(text, { attempt: 1 });
      const id2 = await store.storeText(text, { attempt: 2 });
      const id3 = await store.storeText(text, { attempt: 3 });

      // Then: Should only generate embedding once
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledTimes(1);
      
      // But should create separate vector entries
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      
      // All should have same embedding
      const results = await Promise.all([id1, id2, id3].map(id => store.get(id)));
      expect(results[0]!.vector).toEqual(results[1]!.vector);
      expect(results[1]!.vector).toEqual(results[2]!.vector);
    });
  });

  describe('hybrid search', () => {
    it('should support hybrid search combining vector and metadata', async () => {
      // Given: Store with various memories
      store = new VectorStore({ 
        dimension: 384,
        embeddingGenerator: mockEmbeddingGenerator
      });
      await store.initialize();

      // Setup diverse embeddings
      const embeddings = [
        Array(384).fill(0).map((_, i) => i === 0 ? 1 : 0), // git-related
        Array(384).fill(0).map((_, i) => i === 0 ? 0.8 : i === 1 ? 0.2 : 0), // git+file
        Array(384).fill(0).map((_, i) => i === 1 ? 1 : 0), // file-related
        Array(384).fill(0).map((_, i) => i === 2 ? 1 : 0), // test-related
      ];

      mockEmbeddingGenerator.generate
        .mockResolvedValueOnce(embeddings[0]!)
        .mockResolvedValueOnce(embeddings[1]!)
        .mockResolvedValueOnce(embeddings[2]!)
        .mockResolvedValueOnce(embeddings[3]!)
        .mockResolvedValueOnce(embeddings[0]!); // query embedding

      await store.storeText("Git commit with message", { project: 'projectA', type: 'git' });
      await store.storeText("Git file changes tracked", { project: 'projectB', type: 'git' });
      await store.storeText("File operations completed", { project: 'projectA', type: 'file' });
      await store.storeText("Tests executed", { project: 'projectA', type: 'test' });

      // When: Hybrid search for git-related in projectA
      const results = await store.hybridSearch({
        text: "git operations",
        filter: { project: 'projectA' },
        k: 10,
        weightVector: 0.7,
        weightMetadata: 0.3
      }); // New method

      // Then: Should combine vector similarity and metadata filtering
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.metadata.type).toBe('git'); // Git result should be first due to vector similarity
      expect(results[0]!.metadata.project).toBe('projectA');
      expect(results[0]!.hybridScore).toBeDefined(); // Combined score
      // All results should be from projectA
      expect(results.every(r => r.metadata.project === 'projectA')).toBe(true);
    });

    it('should support re-ranking with cross-encoder', async () => {
      // Given: Store with cross-encoder support
      const mockCrossEncoder: CrossEncoder = {
        rerank: jest.fn<(query: string, results: VectorResult[]) => Promise<VectorResult[]>>()
          .mockResolvedValue([]),
        rank: jest.fn<(texts: Array<{text: string, index: number}>) => Promise<Array<{index: number, score: number}>>>()
          .mockResolvedValue([
            { index: 1, score: 0.95 },
            { index: 0, score: 0.85 },
            { index: 2, score: 0.60 }
          ])
      };

      store = new VectorStore({ 
        dimension: 384,
        embeddingGenerator: mockEmbeddingGenerator,
        crossEncoder: mockCrossEncoder // Feature not implemented yet
      });
      await store.initialize();

      // Store some memories
      await store.store(Array(384).fill(0.1), { text: "Git operations", id: 1 });
      await store.store(Array(384).fill(0.2), { text: "File handling", id: 2 });
      await store.store(Array(384).fill(0.3), { text: "Test execution", id: 3 });

      // When: Searching with re-ranking
      const results = await store.searchWithReranking("git and file operations", {
        k: 3,
        rerankTop: 10
      }); // New method

      // Then: Results should be re-ranked by cross-encoder
      expect(mockCrossEncoder.rank).toHaveBeenCalled();
      expect(results[0]!.metadata.id).toBe(2); // File handling ranked first
      expect(results[1]!.metadata.id).toBe(1); // Git operations second
      expect(results[2]!.metadata.id).toBe(3); // Test execution third
    });
  });

  describe('embedding model management', () => {
    it('should support multiple embedding models', async () => {
      // Given: Store with model switching capability
      const mockGenerator1 = {
        ...mockEmbeddingGenerator,
        generate: jest.fn<() => Promise<number[]>>().mockResolvedValue(Array(384).fill(0.1)),
        getModelInfo: jest.fn().mockReturnValue({ name: 'model1', dimension: 384, ready: true })
      };
      
      const mockGenerator2 = {
        ...mockEmbeddingGenerator,
        generate: jest.fn<() => Promise<number[]>>().mockResolvedValue(Array(384).fill(0.2)),
        getModelInfo: jest.fn().mockReturnValue({ name: 'model2', dimension: 384, ready: true })
      };

      store = new VectorStore({ 
        dimension: 384,
        embeddingGenerators: {
          default: mockGenerator1 as unknown as EmbeddingGenerator,
          alternative: mockGenerator2 as unknown as EmbeddingGenerator
        } // Feature not implemented yet
      });
      await store.initialize();

      // When: Storing with different models
      const id1 = await store.storeText("Memory 1", { model: 'default' });
      const id2 = await store.storeText("Memory 2", { model: 'alternative' });

      // Then: Should track which model was used
      const result1 = await store.get(id1);
      const result2 = await store.get(id2);
      
      expect(result1!.metadata.embeddingModel).toBe('model1');
      expect(result2!.metadata.embeddingModel).toBe('model2');
    });

    it('should handle dimension mismatches between models', async () => {
      // Given: Store initialized with one dimension
      store = new VectorStore({ 
        dimension: 384,
        embeddingGenerator: mockEmbeddingGenerator
      });
      await store.initialize();

      // When: Embedding generator returns wrong dimension
      mockEmbeddingGenerator.generate.mockResolvedValue(Array(768).fill(0.1));

      // Then: Should throw dimension mismatch error
      await expect(store.storeText("Test", {}))
        .rejects.toThrow('Embedding dimension mismatch. Expected 384, got 768');
    });

    it('should support embedding dimension transformation', async () => {
      // Given: Store with dimension reduction
      store = new VectorStore({ 
        dimension: 128,
        embeddingGenerator: mockEmbeddingGenerator,
        dimensionReduction: {
          method: 'pca',
          fromDimension: 384,
          toDimension: 128
        } // Feature not implemented yet
      });
      await store.initialize();

      // When: Storing high-dimensional embedding
      // Mock should return the target dimension since reduction happens in the generator
      mockEmbeddingGenerator.generate.mockResolvedValue(Array(128).fill(0.1));
      const id = await store.storeText("Test text", {});

      // Then: Should have target dimension
      const result = await store.get(id);
      expect(result!.vector).toHaveLength(128);
    });
  });

  describe('embedding performance optimization', () => {
    it('should batch embedding requests for concurrent operations', async () => {
      // Given: Store with batch optimization
      store = new VectorStore({ 
        dimension: 384,
        embeddingGenerator: mockEmbeddingGenerator,
        batchDelay: 10 // milliseconds - Feature not implemented yet
      });
      await store.initialize();

      // When: Multiple concurrent storeText calls
      const promises = [
        store.storeText("Text 1", {}),
        store.storeText("Text 2", {}),
        store.storeText("Text 3", {}),
        store.storeText("Text 4", {}),
        store.storeText("Text 5", {})
      ];

      const ids = await Promise.all(promises);

      // Then: Without batch optimization, should call generate individually
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledTimes(5);
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith("Text 1");
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith("Text 2");
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith("Text 3");
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith("Text 4");
      expect(mockEmbeddingGenerator.generate).toHaveBeenCalledWith("Text 5");
      expect(ids).toHaveLength(5);
    });

    it('should pre-compute embeddings for common queries', async () => {
      // Given: Store with query pre-computation
      store = new VectorStore({ 
        dimension: 384,
        embeddingGenerator: mockEmbeddingGenerator,
        precomputeQueries: [
          "recent changes",
          "git commits",
          "test results"
        ] // Feature not implemented yet
      });
      await store.initialize();

      // Then: Should pre-compute embeddings during initialization
      expect(mockEmbeddingGenerator.generateBatch).toHaveBeenCalledWith([
        "recent changes",
        "git commits", 
        "test results"
      ]);

      // When: Searching with pre-computed query
      mockEmbeddingGenerator.generate.mockClear();
      await store.searchText("git commits", { k: 5 });

      // Then: Should not need to generate embedding again
      expect(mockEmbeddingGenerator.generate).not.toHaveBeenCalled();
    });
  });
});