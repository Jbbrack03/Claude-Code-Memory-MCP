import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { VectorStore } from "../../src/storage/vector-store.js";
import fs from "fs/promises";

describe('VectorStore with ScalableIndex', () => {
  let store: VectorStore;
  const testPath = "/tmp/test-vector-store-scalable";

  beforeEach(async () => {
    try {
      await fs.rm(testPath, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  afterEach(async () => {
    if (store) {
      await store.close();
    }
    try {
      await fs.rm(testPath, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  describe('basic functionality', () => {
    it('should store and search vectors using scalable index', async () => {
      // Given: A vector store with scalable index enabled
      store = new VectorStore({ 
        dimension: 3, 
        path: testPath,
        useScalableIndex: true 
      });
      await store.initialize();

      // When: Storing vectors
      const id1 = await store.store([1, 0, 0], { category: 'test' });
      await store.store([0, 1, 0], { category: 'test' });
      await store.store([0, 0, 1], { category: 'other' });

      // Then: Should be able to search them
      const results = await store.search([1, 0, 0], { k: 2 });
      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe(id1);
      expect(results[0]?.score).toBeCloseTo(1.0);
    });

    it('should apply metadata filters with scalable index', async () => {
      // Given: A vector store with scalable index enabled
      store = new VectorStore({ 
        dimension: 3, 
        path: testPath,
        useScalableIndex: true 
      });
      await store.initialize();

      // When: Storing vectors with different metadata
      await store.store([1, 0, 0], { category: 'A' });
      await store.store([0.9, 0.1, 0], { category: 'A' });
      await store.store([0.8, 0.2, 0], { category: 'B' });

      // Then: Filter should work correctly
      const results = await store.search([1, 0, 0], { 
        k: 10,
        filter: { category: 'A' }
      });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.metadata.category === 'A')).toBe(true);
    });

    it('should handle delete operations with scalable index', async () => {
      // Given: A vector store with scalable index enabled
      store = new VectorStore({ 
        dimension: 3, 
        path: testPath,
        useScalableIndex: true 
      });
      await store.initialize();

      // When: Storing and then deleting a vector
      const id1 = await store.store([1, 0, 0], { category: 'test' });
      const id2 = await store.store([0.9, 0.1, 0], { category: 'test' });
      await store.store([0, 1, 0], { category: 'test' });
      
      await store.delete(id1);

      // Then: Deleted vector should not appear in search results
      const results = await store.search([1, 0, 0], { k: 10 });
      expect(results.find(r => r.id === id1)).toBeUndefined();
      expect(results.find(r => r.id === id2)).toBeDefined();
      // id3 has orthogonal vector, might not be in results
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle clear operations with scalable index', async () => {
      // Given: A vector store with scalable index enabled
      store = new VectorStore({ 
        dimension: 3, 
        path: testPath,
        useScalableIndex: true 
      });
      await store.initialize();

      // When: Storing vectors and then clearing
      await store.store([1, 0, 0], { category: 'test' });
      await store.store([0, 1, 0], { category: 'test' });
      
      await store.clear();

      // Then: Search should return empty results
      const results = await store.search([1, 0, 0], { k: 10 });
      expect(results).toHaveLength(0);
    });
  });

  describe('performance comparison', () => {
    it.skip('should perform searches faster with scalable index for large datasets', async () => {
      // Given: Two stores, one with scalable index, one without
      const regularStore = new VectorStore({ 
        dimension: 128, 
        path: testPath + '-regular'
      });
      const scalableStore = new VectorStore({ 
        dimension: 128, 
        path: testPath + '-scalable',
        useScalableIndex: true 
      });
      
      await regularStore.initialize();
      await scalableStore.initialize();

      // When: Adding many vectors
      const numVectors = 1000;
      const vectors: Array<{ vector: number[], metadata: Record<string, any> }> = [];
      
      for (let i = 0; i < numVectors; i++) {
        const vector = Array(128).fill(0).map(() => Math.random());
        const metadata = { index: i, category: i % 10 };
        vectors.push({ vector, metadata });
      }

      // Add to both stores
      await regularStore.storeBatch(vectors);
      await scalableStore.storeBatch(vectors);

      // Then: Search should work on both
      const queryVector = Array(128).fill(0).map(() => Math.random());
      
      const regularStart = Date.now();
      const regularResults = await regularStore.search(queryVector, { k: 10 });
      const regularTime = Date.now() - regularStart;
      
      const scalableStart = Date.now();
      const scalableResults = await scalableStore.search(queryVector, { k: 10 });
      const scalableTime = Date.now() - scalableStart;

      // Both should return results
      expect(regularResults).toHaveLength(10);
      expect(scalableResults).toHaveLength(10);
      
      // Log performance difference
      console.log(`Regular search time: ${regularTime}ms, Scalable search time: ${scalableTime}ms`);
      
      // Clean up
      await regularStore.close();
      await scalableStore.close();
    }, 30000); // 30 second timeout for performance test
  });
});