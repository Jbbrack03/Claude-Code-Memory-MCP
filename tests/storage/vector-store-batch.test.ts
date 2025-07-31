import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { VectorStore } from "../../src/storage/vector-store.js";
import * as fs from "fs";
import * as path from "path";

describe('VectorStore - Batch Operations', () => {
  let store: VectorStore;
  const testPath = path.join(process.cwd(), '.test-memory', 'vector-batch-test');

  beforeEach(async () => {
    if (fs.existsSync(testPath)) {
      fs.rmSync(testPath, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (store) {
      await store.close();
    }
    if (fs.existsSync(testPath)) {
      fs.rmSync(testPath, { recursive: true, force: true });
    }
  });

  describe('batch insertion', () => {
    it('should insert multiple vectors in a single operation', async () => {
      // Given: A vector store
      store = new VectorStore({ dimension: 3 });
      await store.initialize();

      // When: Inserting batch of vectors
      const vectors = [
        { vector: [1, 0, 0], metadata: { type: 'x-axis', batch: 1 } },
        { vector: [0, 1, 0], metadata: { type: 'y-axis', batch: 1 } },
        { vector: [0, 0, 1], metadata: { type: 'z-axis', batch: 1 } },
        { vector: [1, 1, 0], metadata: { type: 'xy-plane', batch: 1 } },
        { vector: [0, 1, 1], metadata: { type: 'yz-plane', batch: 1 } }
      ];

      const ids = await store.storeBatch(vectors); // New method

      // Then: All vectors should be stored with unique IDs
      expect(Array.isArray(ids)).toBe(true);
      const idsArray = ids as string[];
      expect(idsArray).toHaveLength(5);
      expect(new Set(idsArray).size).toBe(5); // All unique

      // Verify all vectors are retrievable
      for (let i = 0; i < idsArray.length; i++) {
        const result = await store.get(idsArray[i]!);
        expect(result).not.toBeNull();
        expect(result!.vector).toEqual(vectors[i]!.vector);
        expect(result!.metadata).toEqual(vectors[i]!.metadata);
      }
    });

    it('should handle large batch insertions efficiently', async () => {
      // Given: A persistent vector store
      store = new VectorStore({ dimension: 128, path: testPath });
      await store.initialize();

      // Create large batch with deterministic data
      const batchSize = 10000;
      const vectors = Array(batchSize).fill(null).map((_, i) => ({
        vector: Array(128).fill(0).map((_, j) => (i * 128 + j) % 1.0), // Deterministic
        metadata: { 
          index: i, 
          timestamp: 1700000000000 + i, // Fixed base timestamp
          category: `cat_${i % 10}`
        }
      }));

      // When: Inserting large batch
      const startTime = Date.now();
      const ids = await store.storeBatch(vectors);
      const insertTime = Date.now() - startTime;

      // Then: Should complete within performance requirements
      expect(Array.isArray(ids)).toBe(true);
      const idsArray = ids as string[];
      expect(idsArray).toHaveLength(batchSize);
      expect(insertTime).toBeLessThan(5000); // 5 seconds for 10k vectors

      // Verify random samples
      const sampleIndices = [0, 100, 1000, 5000, 9999];
      for (const idx of sampleIndices) {
        const result = await store.get(idsArray[idx]!);
        expect(result!.metadata.index).toBe(idx);
      }
    });

    it('should support batch upsert operations', async () => {
      // Given: Store with existing vectors
      store = new VectorStore({ dimension: 3 });
      await store.initialize();

      // Store initial vectors
      const initial = [
        { id: 'vec_1', vector: [1, 0, 0], metadata: { version: 1 } },
        { id: 'vec_2', vector: [0, 1, 0], metadata: { version: 1 } },
        { id: 'vec_3', vector: [0, 0, 1], metadata: { version: 1 } }
      ];

      await store.upsertBatch(initial); // New method

      // When: Upserting with updates and new vectors
      const updates = [
        { id: 'vec_1', vector: [1, 0.1, 0], metadata: { version: 2 } }, // Update
        { id: 'vec_3', vector: [0, 0.1, 1], metadata: { version: 2 } }, // Update
        { id: 'vec_4', vector: [1, 1, 1], metadata: { version: 1 } }   // New
      ];

      const results = await store.upsertBatch(updates);

      // Then: Should update existing and add new
      expect(results).toEqual({
        updated: ['vec_1', 'vec_3'],
        inserted: ['vec_4']
      });

      // Verify updates
      const vec1 = await store.get('vec_1');
      expect(vec1!.vector).toEqual([1, 0.1, 0]);
      expect(vec1!.metadata.version).toBe(2);

      // Verify unchanged
      const vec2 = await store.get('vec_2');
      expect(vec2!.metadata.version).toBe(1);
    });

    it('should validate all vectors in batch before insertion', async () => {
      // Given: Store with dimension requirement
      store = new VectorStore({ dimension: 3 });
      await store.initialize();

      // When: Batch contains invalid vector
      const invalidBatch = [
        { vector: [1, 0, 0], metadata: {} },
        { vector: [0, 1], metadata: {} }, // Wrong dimension
        { vector: [0, 0, 1], metadata: {} }
      ];

      // Then: Should reject entire batch
      await expect(store.storeBatch(invalidBatch))
        .rejects.toThrow('Batch validation failed: Vector at index 1 has dimension 2, expected 3');

      // Verify no vectors were stored
      const searchResults = await store.search([1, 0, 0], { k: 10 });
      expect(searchResults).toHaveLength(0);
    });

    it('should support transactional batch operations', async () => {
      // Given: Store with transaction support
      store = new VectorStore({ 
        dimension: 3, 
        path: testPath,
        transactional: true // Feature not implemented yet
      });
      await store.initialize();

      // When: Batch operation fails midway
      const problematicBatch = [
        { vector: [1, 0, 0], metadata: { order: 1 } },
        { vector: [0, 1, 0], metadata: { order: 2 } },
        { vector: null as any, metadata: { order: 3 } }, // Will cause error
        { vector: [0, 0, 1], metadata: { order: 4 } }
      ];

      // Then: Should rollback entire batch
      await expect(store.storeBatch(problematicBatch))
        .rejects.toThrow();

      // Verify no partial data was stored
      const results = await store.search([1, 0, 0], { k: 10 });
      expect(results).toHaveLength(0);
    });

    it('should support batch operations with progress callback', async () => {
      // Given: Store with progress tracking
      store = new VectorStore({ dimension: 3 });
      await store.initialize();

      const progressUpdates: any[] = [];
      const progressCallback = (progress: {
        processed: number;
        total: number;
        percentage: number;
        currentId?: string;
      }) => {
        progressUpdates.push({ ...progress });
      };

      // When: Storing batch with progress
      const vectors = Array(100).fill(null).map((_, i) => ({
        vector: [Math.random(), Math.random(), Math.random()],
        metadata: { index: i }
      }));

      await store.storeBatch(vectors, { 
        onProgress: progressCallback // Feature not implemented yet
      });

      // Then: Should receive progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[0]!.processed).toBe(0);
      expect(progressUpdates[progressUpdates.length - 1]!.processed).toBe(100);
      expect(progressUpdates[progressUpdates.length - 1]!.percentage).toBe(100);
    });
  });

  describe('batch retrieval', () => {
    beforeEach(async () => {
      store = new VectorStore({ dimension: 3 });
      await store.initialize();
    });

    it('should retrieve multiple vectors by IDs', async () => {
      // Given: Stored vectors
      const ids = await Promise.all([
        store.store([1, 0, 0], { type: 'x' }),
        store.store([0, 1, 0], { type: 'y' }),
        store.store([0, 0, 1], { type: 'z' })
      ]);

      // When: Batch retrieval
      const results = await store.getBatch(ids); // New method

      // Then: Should return all vectors in order
      expect(results).toHaveLength(3);
      expect(results[0]!.vector).toEqual([1, 0, 0]);
      expect(results[1]!.vector).toEqual([0, 1, 0]);
      expect(results[2]!.vector).toEqual([0, 0, 1]);
    });

    it('should handle missing IDs in batch retrieval', async () => {
      // Given: Some stored vectors
      const id1 = await store.store([1, 0, 0], {});
      const id2 = await store.store([0, 1, 0], {});

      // When: Retrieving with non-existent ID
      const results = await store.getBatch([
        id1,
        'non-existent-id',
        id2,
        'another-missing-id'
      ]);

      // Then: Should return null for missing IDs
      expect(results).toHaveLength(4);
      expect(results[0]).not.toBeNull();
      expect(results[1]).toBeNull();
      expect(results[2]).not.toBeNull();
      expect(results[3]).toBeNull();
    });

    it('should support batch retrieval with metadata filtering', async () => {
      // Given: Vectors with various metadata
      const vectors = [];
      for (let i = 0; i < 20; i++) {
        vectors.push({
          vector: [Math.random(), Math.random(), Math.random()],
          metadata: {
            category: i < 10 ? 'A' : 'B',
            priority: i % 3,
            timestamp: Date.now() + i
          }
        });
      }
      await store.storeBatch(vectors);

      // When: Batch retrieval with filter
      const results = await store.getBatchByFilter({
        category: 'A',
        priority: 1
      }); // New method

      // Then: Should only return matching vectors
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.metadata.category === 'A')).toBe(true);
      expect(results.every(r => r.metadata.priority === 1)).toBe(true);
    });

    it('should support pagination for large result sets', async () => {
      // Given: Many vectors
      const vectors = Array(100).fill(null).map((_, i) => ({
        vector: [Math.random(), Math.random(), Math.random()],
        metadata: { index: i, type: 'test' }
      }));
      await store.storeBatch(vectors);

      // When: Paginated retrieval
      const page1 = await store.getBatchByFilter(
        { type: 'test' },
        { offset: 0, limit: 20 } // Feature not implemented yet
      );
      const page2 = await store.getBatchByFilter(
        { type: 'test' },
        { offset: 20, limit: 20 }
      );

      // Then: Should return different pages
      expect(page1).toHaveLength(20);
      expect(page2).toHaveLength(20);
      expect(page1[0]!.metadata.index).toBe(0);
      expect(page2[0]!.metadata.index).toBe(20);
    });
  });

  describe('batch deletion', () => {
    beforeEach(async () => {
      store = new VectorStore({ dimension: 3, path: testPath });
      await store.initialize();
    });

    it('should delete multiple vectors by IDs', async () => {
      // Given: Stored vectors
      const ids = await Promise.all([
        store.store([1, 0, 0], { keep: false }),
        store.store([0, 1, 0], { keep: true }),
        store.store([0, 0, 1], { keep: false }),
        store.store([1, 1, 0], { keep: true }),
        store.store([0, 1, 1], { keep: false })
      ]);

      // When: Batch deletion
      const toDelete = [ids[0], ids[2], ids[4]];
      const results = await store.deleteBatch(toDelete); // New method

      // Then: Should delete specified vectors
      expect(results).toEqual({
        deleted: toDelete,
        notFound: []
      });

      // Verify deletion
      for (const id of toDelete) {
        expect(await store.get(id!)).toBeNull();
      }

      // Verify others remain
      expect(await store.get(ids[1]!)).not.toBeNull();
      expect(await store.get(ids[3]!)).not.toBeNull();
    });

    it('should report non-existent IDs in batch deletion', async () => {
      // Given: Some vectors
      const id = await store.store([1, 0, 0], {});

      // When: Deleting mix of existing and non-existing
      const results = await store.deleteBatch([
        id,
        'fake-id-1',
        'fake-id-2'
      ]);

      // Then: Should report what was deleted and what wasn't found
      expect(results).toEqual({
        deleted: [id],
        notFound: ['fake-id-1', 'fake-id-2']
      });
    });

    it('should support batch deletion by metadata filter', async () => {
      // Given: Vectors with metadata
      await store.storeBatch([
        { vector: [1, 0, 0], metadata: { session: 's1', type: 'temp' } },
        { vector: [0, 1, 0], metadata: { session: 's1', type: 'permanent' } },
        { vector: [0, 0, 1], metadata: { session: 's2', type: 'temp' } },
        { vector: [1, 1, 0], metadata: { session: 's2', type: 'permanent' } }
      ]);

      // When: Deleting by filter
      const results = await store.deleteByFilter({
        session: 's1',
        type: 'temp'
      }); // New method

      // Then: Should only delete matching vectors
      expect(results.deletedCount).toBe(1);

      // Verify correct vectors remain
      const remaining = await store.search([1, 0, 0], { k: 10 });
      expect(remaining).toHaveLength(3);
      expect(remaining.some(r => 
        r.metadata.session === 's1' && r.metadata.type === 'temp'
      )).toBe(false);
    });

    it('should handle batch deletion atomically', async () => {
      // Given: Persistent store with vectors
      const ids = await store.storeBatch([
        { vector: [1, 0, 0], metadata: { order: 1 } },
        { vector: [0, 1, 0], metadata: { order: 2 } },
        { vector: [0, 0, 1], metadata: { order: 3 } }
      ]);

      // Simulate failure during deletion
      const originalDelete = store.delete.bind(store);
      let deleteCount = 0;
      store.delete = jest.fn(async (id: string) => {
        deleteCount++;
        if (deleteCount === 2) {
          throw new Error('Simulated failure');
        }
        return originalDelete(id);
      });

      // When: Batch deletion fails
      const idsArray = ids as string[];
      await expect(store.deleteBatch(idsArray))
        .rejects.toThrow('Simulated failure');

      // Then: No vectors should be deleted (rollback)
      for (const id of idsArray) {
        expect(await store.get(id)).not.toBeNull();
      }
    });
  });

  describe('batch search operations', () => {
    beforeEach(async () => {
      store = new VectorStore({ dimension: 3 });
      await store.initialize();

      // Setup test data
      await store.storeBatch([
        { vector: [1, 0, 0], metadata: { category: 'axis', label: 'x' } },
        { vector: [0, 1, 0], metadata: { category: 'axis', label: 'y' } },
        { vector: [0, 0, 1], metadata: { category: 'axis', label: 'z' } },
        { vector: [0.7, 0.7, 0], metadata: { category: 'diagonal', label: 'xy' } },
        { vector: [0, 0.7, 0.7], metadata: { category: 'diagonal', label: 'yz' } }
      ]);
    });

    it('should perform multiple searches in batch', async () => {
      // Given: Multiple query vectors
      const queries = [
        { vector: [1, 0, 0], k: 2 },
        { vector: [0, 1, 0], k: 2 },
        { vector: [0.5, 0.5, 0], k: 3 }
      ];

      // When: Batch search
      const results = await store.searchBatch(queries); // New method

      // Then: Should return results for each query
      expect(results).toHaveLength(3);
      
      // First query results
      expect(results[0]).toHaveLength(2);
      expect(results[0]![0]!.metadata.label).toBe('x');
      
      // Second query results
      expect(results[1]).toHaveLength(2);
      expect(results[1]![0]!.metadata.label).toBe('y');
      
      // Third query results
      expect(results[2]).toHaveLength(3);
      expect(results[2]![0]!.metadata.label).toBe('xy');
    });

    it('should support different search parameters per query', async () => {
      // Given: Queries with different parameters
      const queries = [
        { 
          vector: [1, 0, 0], 
          k: 5,
          filter: { category: 'axis' },
          threshold: 0.5
        },
        { 
          vector: [0.5, 0.5, 0.5], 
          k: 2,
          filter: { category: 'diagonal' }
        }
      ];

      // When: Batch search with varied parameters
      const results = await store.searchBatch(queries);

      // Then: Each query should respect its parameters
      expect(results[0]!.every(r => r.metadata.category === 'axis')).toBe(true);
      expect(results[0]!.every(r => r.score >= 0.5)).toBe(true);
      
      expect(results[1]).toHaveLength(2);
      expect(results[1]!.every(r => r.metadata.category === 'diagonal')).toBe(true);
    });

    it('should optimize batch search performance', async () => {
      // Given: Large dataset
      const largeDataset = Array(1000).fill(null).map((_, i) => ({
        vector: [Math.random(), Math.random(), Math.random()],
        metadata: { id: i }
      }));
      await store.storeBatch(largeDataset);

      // Multiple queries
      const queries = Array(10).fill(null).map(() => ({
        vector: [Math.random(), Math.random(), Math.random()],
        k: 10
      }));

      // When: Batch search
      const startTime = Date.now();
      const results = await store.searchBatch(queries);
      const searchTime = Date.now() - startTime;

      // Then: Should be faster than sequential searches
      expect(results).toHaveLength(10);
      expect(searchTime).toBeLessThan(1000); // Should complete in under 1 second

      // Compare with sequential
      const sequentialStart = Date.now();
      for (const query of queries) {
        await store.search(query.vector, { k: query.k });
      }
      const sequentialTime = Date.now() - sequentialStart;

      // Batch should be comparable to sequential (allowing for overhead)
      expect(searchTime).toBeLessThan(sequentialTime * 2);
    });
  });

  describe('batch operation error handling', () => {
    beforeEach(async () => {
      store = new VectorStore({ dimension: 3 });
      await store.initialize();
    });

    it('should provide detailed error information for batch failures', async () => {
      // Given: Batch with multiple validation errors
      const problematicBatch = [
        { vector: [1, 0, 0], metadata: {} }, // Valid
        { vector: [1, 0], metadata: {} }, // Wrong dimension
        { vector: null as any, metadata: {} }, // Null vector
        { vector: [1, 0, 0], metadata: {} }, // Valid
        { vector: [], metadata: {} } // Empty vector
      ];

      // When: Attempting batch insert
      try {
        await store.storeBatch(problematicBatch);
        fail('Should have thrown an error');
      } catch (error: any) {
        // Then: Error should contain detailed information
        expect(error.message).toContain('Batch validation failed');
        expect(error.details).toBeDefined(); // Feature not implemented yet
        expect(error.details).toEqual([
          { index: 1, error: 'Wrong dimension: expected 3, got 2' },
          { index: 2, error: 'Vector cannot be null' },
          { index: 4, error: 'Wrong dimension: expected 3, got 0' }
        ]);
      }
    });

    it('should support partial batch operations with error handling', async () => {
      // Given: Store with partial batch mode
      store = new VectorStore({ 
        dimension: 3,
        allowPartialBatch: true // Feature not implemented yet
      });
      await store.initialize();

      const mixedBatch = [
        { vector: [1, 0, 0], metadata: { valid: true } },
        { vector: [1, 0], metadata: { valid: false } }, // Invalid
        { vector: [0, 1, 0], metadata: { valid: true } },
        { vector: null as any, metadata: { valid: false } }, // Invalid
        { vector: [0, 0, 1], metadata: { valid: true } }
      ];

      // When: Storing with partial mode
      const results = await store.storeBatch(mixedBatch);

      // Then: Should store valid vectors and report errors
      expect(results).toHaveProperty('stored');
      expect(results).toHaveProperty('errors');
      if ('stored' in results && 'errors' in results) {
        expect(results.stored).toHaveLength(3);
        expect(results.errors).toHaveLength(2);
        expect(results.errors[0]).toEqual({
          index: 1,
          error: 'Wrong dimension: expected 3, got 2'
        });
        expect(results.errors[1]).toEqual({
          index: 3,
          error: 'Vector cannot be null'
        });
      }

      // Verify only valid vectors were stored
      const searchResults = await store.search([1, 0, 0], { k: 10 });
      expect(searchResults.every(r => r.metadata.valid === true)).toBe(true);
    });
  });
});