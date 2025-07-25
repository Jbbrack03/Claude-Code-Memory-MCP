import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { VectorStore } from "../../src/storage/vector-store.js";
import fs from "fs";
import path from "path";

describe('VectorStore', () => {
  let store: VectorStore;
  const testPath = path.join(process.cwd(), '.test-memory', 'vector-test');
  
  beforeEach(async () => {
    // Clean up any existing test directory
    if (fs.existsSync(testPath)) {
      fs.rmSync(testPath, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    // Clean up after tests
    if (store) {
      await store.close();
    }
    if (fs.existsSync(testPath)) {
      fs.rmSync(testPath, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should initialize with in-memory storage', async () => {
      // Given: A vector store without path (in-memory)
      store = new VectorStore({ dimension: 384 });
      
      // When: Store is initialized
      await store.initialize();
      
      // Then: Store is ready to use
      const id = await store.store(new Array(384).fill(0.1));
      expect(id).toMatch(/^vec_\d+_[a-z0-9]+$/);
    });

    it('should initialize with persistent storage', async () => {
      // Given: A vector store with path
      store = new VectorStore({ dimension: 384, path: testPath });
      
      // When: Store is initialized
      await store.initialize();
      
      // Then: Directory is created
      expect(fs.existsSync(testPath)).toBe(true);
    });

    it('should load existing vectors on initialization', async () => {
      // Given: Existing vectors on disk
      store = new VectorStore({ dimension: 3, path: testPath });
      await store.initialize();
      
      const id1 = await store.store([1, 2, 3], { type: 'test' });
      const id2 = await store.store([4, 5, 6], { type: 'test' });
      await store.close();
      
      // When: New store initialized
      const newStore = new VectorStore({ dimension: 3, path: testPath });
      await newStore.initialize();
      
      // Then: Vectors are loaded
      const result1 = await newStore.get(id1);
      const result2 = await newStore.get(id2);
      expect(result1?.vector).toEqual([1, 2, 3]);
      expect(result2?.vector).toEqual([4, 5, 6]);
      
      await newStore.close();
    });
  });

  describe('vector storage', () => {
    beforeEach(async () => {
      store = new VectorStore({ dimension: 3 });
      await store.initialize();
    });

    it('should store vector with metadata', async () => {
      // Given: A vector with metadata
      const vector = [0.1, 0.2, 0.3];
      const metadata = { memoryId: 'mem123', eventType: 'file_write' };
      
      // When: Vector is stored
      const id = await store.store(vector, metadata);
      
      // Then: Vector is retrievable
      const result = await store.get(id);
      expect(result).not.toBeNull();
      expect(result!.vector).toEqual(vector);
      expect(result!.metadata).toEqual(metadata);
      expect(result!.score).toBe(1.0);
    });

    it('should validate vector dimension', async () => {
      // Given: A vector with wrong dimension
      const wrongVector = [0.1, 0.2]; // Should be 3D
      
      // Then: Store throws dimension error
      await expect(store.store(wrongVector))
        .rejects.toThrow('Vector dimension mismatch. Expected 3, got 2');
    });

    it('should generate unique IDs', async () => {
      // Given: Multiple vectors
      const vectors = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9]
      ];
      
      // When: Vectors are stored
      const ids = await Promise.all(vectors.map(v => store.store(v)));
      
      // Then: All IDs are unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('vector search', () => {
    beforeEach(async () => {
      store = new VectorStore({ dimension: 3 });
      await store.initialize();
    });

    it('should find similar vectors', async () => {
      // Given: Several vectors
      await store.store([1, 0, 0], { type: 'x-axis' });
      await store.store([0, 1, 0], { type: 'y-axis' });
      await store.store([0, 0, 1], { type: 'z-axis' });
      await store.store([0.9, 0.1, 0], { type: 'near-x' });
      
      // When: Searching for similar to x-axis
      const results = await store.search([1, 0, 0], { k: 2 });
      
      // Then: Returns most similar vectors
      expect(results).toHaveLength(2);
      expect(results[0]!.metadata.type).toBe('x-axis');
      expect(results[0]!.score).toBe(1.0); // Perfect match
      expect(results[1]!.metadata.type).toBe('near-x');
      expect(results[1]!.score).toBeGreaterThan(0.9);
    });

    it('should apply metadata filters', async () => {
      // Given: Vectors with different metadata
      await store.store([1, 0, 0], { sessionId: 's1', type: 'test' });
      await store.store([0.9, 0.1, 0], { sessionId: 's1', type: 'test' });
      await store.store([0.8, 0.2, 0], { sessionId: 's2', type: 'test' });
      
      // When: Searching with filter
      const results = await store.search([1, 0, 0], { 
        k: 10,
        filter: { sessionId: 's1' }
      });
      
      // Then: Only filtered results returned
      expect(results).toHaveLength(2);
      expect(results.every(r => r.metadata.sessionId === 's1')).toBe(true);
    });

    it('should apply similarity threshold', async () => {
      // Given: Vectors with varying similarity
      await store.store([1, 0, 0], { type: 'perfect' });
      await store.store([0.9, 0.1, 0], { type: 'close' });
      await store.store([0.5, 0.5, 0], { type: 'medium' });
      await store.store([0, 1, 0], { type: 'orthogonal' });
      
      // When: Searching with threshold
      const results = await store.search([1, 0, 0], { 
        k: 10,
        threshold: 0.8
      });
      
      // Then: Only high similarity results returned
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every(r => r.score >= 0.8)).toBe(true);
    });

    it('should handle empty search results', async () => {
      // Given: No matching vectors
      await store.store([1, 0, 0], { type: 'test' });
      
      // When: Searching with impossible filter
      const results = await store.search([1, 0, 0], {
        k: 10,
        filter: { nonExistentKey: 'value' }
      });
      
      // Then: Returns empty array
      expect(results).toEqual([]);
    });
  });

  describe('vector operations', () => {
    beforeEach(async () => {
      store = new VectorStore({ dimension: 3 });
      await store.initialize();
    });

    it('should delete vectors', async () => {
      // Given: A stored vector
      const id = await store.store([1, 2, 3]);
      expect(await store.get(id)).not.toBeNull();
      
      // When: Vector is deleted
      const deleted = await store.delete(id);
      
      // Then: Vector no longer exists
      expect(deleted).toBe(true);
      expect(await store.get(id)).toBeNull();
    });

    it('should return false when deleting non-existent vector', async () => {
      // When: Deleting non-existent vector
      const deleted = await store.delete('non-existent-id');
      
      // Then: Returns false
      expect(deleted).toBe(false);
    });

    it('should clear all vectors', async () => {
      // Given: Multiple vectors
      await store.store([1, 0, 0]);
      await store.store([0, 1, 0]);
      await store.store([0, 0, 1]);
      
      // When: Store is cleared
      await store.clear();
      
      // Then: No vectors remain
      const results = await store.search([1, 0, 0], { k: 10 });
      expect(results).toEqual([]);
    });
  });

  describe('persistence', () => {
    it('should persist vectors to disk', async () => {
      // Given: A persistent store
      store = new VectorStore({ dimension: 3, path: testPath });
      await store.initialize();
      
      const id = await store.store([1, 2, 3], { test: true });
      
      // Then: Vector file exists
      const indexFile = path.join(testPath, 'vectors.json');
      expect(fs.existsSync(indexFile)).toBe(true);
      
      const data = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
      expect(data[id]).toEqual({
        vector: [1, 2, 3],
        metadata: { test: true }
      });
    });

    it('should persist after delete operations', async () => {
      // Given: A persistent store with vectors
      store = new VectorStore({ dimension: 3, path: testPath });
      await store.initialize();
      
      const id1 = await store.store([1, 0, 0]);
      const id2 = await store.store([0, 1, 0]);
      await store.delete(id1);
      
      // When: New store loads
      await store.close();
      const newStore = new VectorStore({ dimension: 3, path: testPath });
      await newStore.initialize();
      
      // Then: Only non-deleted vector exists
      expect(await newStore.get(id1)).toBeNull();
      expect(await newStore.get(id2)).not.toBeNull();
      
      await newStore.close();
    });
  });

  describe('error handling', () => {
    it('should throw when used before initialization', async () => {
      // Given: Uninitialized store
      store = new VectorStore({ dimension: 3 });
      
      // Then: Operations throw
      await expect(store.store([1, 2, 3]))
        .rejects.toThrow('Vector store not initialized');
      await expect(store.get('test'))
        .rejects.toThrow('Vector store not initialized');
      await expect(store.search([1, 2, 3], { k: 1 }))
        .rejects.toThrow('Vector store not initialized');
    });

    it('should validate query vector dimension', async () => {
      // Given: Initialized store
      store = new VectorStore({ dimension: 3 });
      await store.initialize();
      
      // When: Searching with wrong dimension
      // Then: Throws dimension error
      await expect(store.search([1, 2], { k: 1 }))
        .rejects.toThrow('Query vector dimension mismatch. Expected 3, got 2');
    });
  });
});