import { describe, it, expect, beforeEach } from "@jest/globals";
import { VectorStore } from "../../src/storage/vector-store.js";
import { IndexedVectorStore } from "../../src/intelligence/vector-index-integration.js";
import { SimpleVectorIndex } from "../../src/intelligence/vector-index.js";

describe('IndexedVectorStore', () => {
  let vectorStore: VectorStore;
  let indexedStore: IndexedVectorStore;

  beforeEach(async () => {
    vectorStore = new VectorStore({ dimension: 3, provider: 'local' });
    await vectorStore.initialize();
    indexedStore = new IndexedVectorStore(vectorStore);
  });

  describe('integration', () => {
    it('should add vectors to both store and index', async () => {
      const id1 = await indexedStore.addVector([1, 0, 0], { type: 'test' });
      const id2 = await indexedStore.addVector([0, 1, 0], { type: 'test' });
      
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      
      const stats = indexedStore.getIndexStats();
      expect(stats.indexSize).toBe(2);
      expect(stats.metadataSize).toBe(2);
    });

    it('should search using the index', async () => {
      // Add test vectors
      await indexedStore.addVector([1, 0, 0], { name: 'x-axis' });
      await indexedStore.addVector([0, 1, 0], { name: 'y-axis' });
      await indexedStore.addVector([0, 0, 1], { name: 'z-axis' });
      await indexedStore.addVector([0.7071, 0.7071, 0], { name: 'xy-diagonal' });
      
      // Search for similar vectors
      const results = await indexedStore.searchWithIndex([1, 0, 0], { k: 2 });
      
      expect(results).toHaveLength(2);
      expect(results[0]?.metadata.name).toBe('x-axis');
      expect(results[1]?.metadata.name).toBe('xy-diagonal');
    });

    it('should apply filters during search', async () => {
      // Add vectors with different types
      await indexedStore.addVector([1, 0, 0], { type: 'A', value: 1 });
      await indexedStore.addVector([0.9, 0.1, 0], { type: 'B', value: 2 });
      await indexedStore.addVector([0.95, 0.05, 0], { type: 'A', value: 3 });
      
      // Search with filter
      const results = await indexedStore.searchWithIndex([1, 0, 0], {
        k: 3,
        filter: { type: 'A' }
      });
      
      expect(results).toHaveLength(2);
      expect(results.every(r => r.metadata.type === 'A')).toBe(true);
    });

    it('should respect threshold during search', async () => {
      await indexedStore.addVector([1, 0, 0], { name: 'exact' });
      await indexedStore.addVector([0.9, 0.436, 0], { name: 'similar' }); // ~0.9 similarity
      await indexedStore.addVector([0, 1, 0], { name: 'orthogonal' }); // 0 similarity
      
      const results = await indexedStore.searchWithIndex([1, 0, 0], {
        k: 10,
        threshold: 0.8
      });
      
      expect(results).toHaveLength(2);
      expect(results.every(r => r.score >= 0.8)).toBe(true);
    });

    it('should remove vectors from both store and index', async () => {
      const id1 = await indexedStore.addVector([1, 0, 0], { name: 'vec1' });
      await indexedStore.addVector([0, 1, 0], { name: 'vec2' });
      
      expect(indexedStore.getIndexStats().indexSize).toBe(2);
      
      await indexedStore.removeVector(id1);
      
      expect(indexedStore.getIndexStats().indexSize).toBe(1);
      
      const results = await indexedStore.searchWithIndex([1, 0, 0], { k: 2 });
      expect(results.find(r => r.id === id1)).toBeUndefined();
    });

    it('should build index from existing store', async () => {
      // Add vectors directly to store
      await vectorStore.store([1, 0, 0], { name: 'direct1' });
      await vectorStore.store([0, 1, 0], { name: 'direct2' });
      await vectorStore.store([0, 0, 1], { name: 'direct3' });
      
      // Create new indexed store and build index
      const newIndexedStore = new IndexedVectorStore(vectorStore);
      await newIndexedStore.buildIndex();
      
      expect(newIndexedStore.getIndexStats().indexSize).toBe(3);
      
      // Verify search works
      const results = await newIndexedStore.searchWithIndex([1, 0, 0], { k: 1 });
      expect(results[0]?.metadata.name).toBe('direct1');
    });
  });

  describe('edge cases', () => {
    it('should handle empty index', async () => {
      const results = await indexedStore.searchWithIndex([1, 0, 0], { k: 5 });
      expect(results).toEqual([]);
    });

    it('should handle k larger than index size', async () => {
      await indexedStore.addVector([1, 0, 0], { id: 1 });
      await indexedStore.addVector([0, 1, 0], { id: 2 });
      
      const results = await indexedStore.searchWithIndex([1, 0, 0], { k: 10 });
      expect(results).toHaveLength(2);
    });

    it('should handle custom index instance', async () => {
      const customIndex = new SimpleVectorIndex();
      const customIndexedStore = new IndexedVectorStore(vectorStore, customIndex);
      
      await customIndexedStore.addVector([1, 0, 0], { custom: true });
      const stats = customIndexedStore.getIndexStats();
      expect(stats.indexSize).toBe(1);
    });
  });
});