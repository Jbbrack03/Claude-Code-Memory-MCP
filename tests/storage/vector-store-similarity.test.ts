import { describe, it, expect, beforeEach } from "@jest/globals";
import { VectorStore } from "../../src/storage/vector-store.js";

describe('VectorStore - Cosine Similarity', () => {
  let store: VectorStore;

  beforeEach(async () => {
    store = new VectorStore({ dimension: 3 });
    await store.initialize();
  });

  describe('similarity calculations', () => {
    it('should calculate cosine similarity correctly for orthogonal vectors', async () => {
      // Given: Orthogonal vectors (90 degrees apart)
      const orthogonalVectors = [
        { vector: [1, 0, 0], label: 'x-axis' },
        { vector: [0, 1, 0], label: 'y-axis' },
        { vector: [0, 0, 1], label: 'z-axis' }
      ];

      // When: Storing vectors and calculating similarities
      for (const v of orthogonalVectors) {
        await store.store(v.vector, { label: v.label });
      }

      // Then: Orthogonal vectors should have zero similarity
      const xResults = await store.search([1, 0, 0], { k: 3 });
      const yResult = xResults.find(r => r.metadata.label === 'y-axis');
      const zResult = xResults.find(r => r.metadata.label === 'z-axis');

      expect(yResult?.score).toBeCloseTo(0, 5);
      expect(zResult?.score).toBeCloseTo(0, 5);
    });

    it('should calculate cosine similarity correctly for parallel vectors', async () => {
      // Given: Parallel vectors (same direction)
      const parallelVectors = [
        { vector: [1, 0, 0], label: 'unit' },
        { vector: [2, 0, 0], label: 'scaled' },
        { vector: [0.5, 0, 0], label: 'half' }
      ];

      // When: Storing vectors and searching
      for (const v of parallelVectors) {
        await store.store(v.vector, { label: v.label });
      }

      const results = await store.search([3, 0, 0], { k: 3 });

      // Then: All parallel vectors should have similarity of 1.0
      expect(results).toHaveLength(3);
      for (const result of results) {
        expect(result.score).toBeCloseTo(1.0, 5);
      }
    });

    it('should calculate cosine similarity correctly for opposite vectors', async () => {
      // Given: Opposite vectors (180 degrees apart)
      await store.store([1, 0, 0], { label: 'positive' });
      await store.store([-1, 0, 0], { label: 'negative' });

      // When: Searching with positive vector
      const results = await store.search([1, 0, 0], { k: 2 });
      const negativeResult = results.find(r => r.metadata.label === 'negative');

      // Then: Opposite vectors should have similarity of -1.0
      expect(negativeResult?.score).toBeCloseTo(-1.0, 5);
    });

    it('should handle zero-magnitude vectors gracefully', async () => {
      // Given: A zero vector
      await store.store([0, 0, 0], { label: 'zero' });
      await store.store([1, 1, 1], { label: 'normal' });

      // When: Searching with a normal vector
      const results = await store.search([1, 0, 0], { k: 2 });
      const zeroResult = results.find(r => r.metadata.label === 'zero');

      // Then: Zero vector should have score of 0
      expect(zeroResult?.score).toBe(0);
    });

    it('should normalize vectors before similarity calculation', async () => {
      // Given: Vectors with different magnitudes
      const vectors = [
        { vector: [3, 4, 0], label: 'magnitude-5' },
        { vector: [6, 8, 0], label: 'magnitude-10' },
        { vector: [0.6, 0.8, 0], label: 'magnitude-1' }
      ];

      // When: Storing and searching
      for (const v of vectors) {
        await store.store(v.vector, { label: v.label });
      }

      const results = await store.search([30, 40, 0], { k: 3 });

      // Then: All vectors should have same similarity (direction matters, not magnitude)
      expect(results).toHaveLength(3);
      const scores = results.map(r => r.score);
      expect(scores[0]).toBeCloseTo(scores[1]!, 5);
      expect(scores[1]).toBeCloseTo(scores[2]!, 5);
    });

    it('should rank results by similarity score correctly', async () => {
      // Given: Vectors with varying similarities to query
      const vectors = [
        { vector: [1, 0, 0], similarity: 1.0, label: 'exact' },
        { vector: [0.9, 0.1, 0], similarity: 0.9939, label: 'very-close' },
        { vector: [0.7, 0.7, 0], similarity: 0.707, label: 'medium' },
        { vector: [0, 1, 0], similarity: 0.0, label: 'orthogonal' },
        { vector: [-0.5, 0.5, 0.707], similarity: -0.500, label: 'negative' }
      ];

      // When: Storing vectors
      for (const v of vectors) {
        await store.store(v.vector, { label: v.label, expectedSimilarity: v.similarity });
      }

      // Then: Results should be ranked by similarity
      const results = await store.search([1, 0, 0], { k: 5 });
      expect(results[0]!.metadata.label).toBe('exact');
      expect(results[1]!.metadata.label).toBe('very-close');
      expect(results[2]!.metadata.label).toBe('medium');
      expect(results[3]!.metadata.label).toBe('orthogonal');
      expect(results[4]!.metadata.label).toBe('negative');

      // Verify approximate similarity scores
      for (const result of results) {
        const expected = result.metadata.expectedSimilarity as number;
        expect(result.score).toBeCloseTo(expected, 2);
      }
    });

    it('should support angular distance metric', async () => {
      // Given: Store configured with angular distance
      const angularStore = new VectorStore({ 
        dimension: 3,
        metric: 'angular' // Feature not implemented yet
      });
      await angularStore.initialize();

      // When: Storing vectors and searching
      await angularStore.store([1, 0, 0], { label: 'ref' });
      await angularStore.store([0.707, 0.707, 0], { label: '45-degrees' });
      await angularStore.store([0, 1, 0], { label: '90-degrees' });

      const results = await angularStore.search([1, 0, 0], { k: 3 });

      // Then: Results should be ranked by angular distance
      const angleResults = results.map(r => ({
        label: r.metadata.label,
        angularDistance: r.score // Should be in radians or degrees
      }));

      expect(angleResults[0]!.label).toBe('ref');
      expect(angleResults[0]!.angularDistance).toBeCloseTo(0, 5);
      expect(angleResults[1]!.label).toBe('45-degrees');
      expect(angleResults[1]!.angularDistance).toBeCloseTo(Math.PI / 4, 2);
      expect(angleResults[2]!.label).toBe('90-degrees');
      expect(angleResults[2]!.angularDistance).toBeCloseTo(Math.PI / 2, 2);

      await angularStore.close();
    });

    it('should support euclidean distance metric', async () => {
      // Given: Store configured with euclidean distance
      const euclideanStore = new VectorStore({ 
        dimension: 3,
        metric: 'euclidean' // Feature not implemented yet
      });
      await euclideanStore.initialize();

      // When: Storing vectors and searching
      await euclideanStore.store([0, 0, 0], { label: 'origin' });
      await euclideanStore.store([1, 0, 0], { label: 'unit-x' });
      await euclideanStore.store([3, 4, 0], { label: 'point-5' });

      const results = await euclideanStore.search([0, 0, 0], { k: 3 });

      // Then: Results should be ranked by euclidean distance
      expect(results[0]!.metadata.label).toBe('origin');
      expect(results[0]!.score).toBe(0); // Distance to itself
      expect(results[1]!.metadata.label).toBe('unit-x');
      expect(results[1]!.score).toBe(1); // Distance 1
      expect(results[2]!.metadata.label).toBe('point-5');
      expect(results[2]!.score).toBe(5); // Distance sqrt(3^2 + 4^2) = 5

      await euclideanStore.close();
    });
  });

  describe('similarity performance', () => {
    it('should handle high-dimensional vectors efficiently', async () => {
      // Given: High-dimensional vectors (e.g., 768 dimensions)
      const highDimStore = new VectorStore({ dimension: 768 });
      await highDimStore.initialize();

      // Create random high-dimensional vectors
      const numVectors = 1000;
      const vectors: number[][] = [];
      for (let i = 0; i < numVectors; i++) {
        const vector = Array(768).fill(0).map(() => Math.random() - 0.5);
        vectors.push(vector);
        await highDimStore.store(vector, { id: i });
      }

      // When: Performing search
      const queryVector = Array(768).fill(0).map(() => Math.random() - 0.5);
      const startTime = Date.now();
      const results = await highDimStore.search(queryVector, { k: 10 });
      const searchTime = Date.now() - startTime;

      // Then: Search should complete within performance requirements
      expect(results).toHaveLength(10);
      expect(searchTime).toBeLessThan(200); // 200ms requirement from CLAUDE.md

      await highDimStore.close();
    });

    it('should use optimized similarity calculation for sparse vectors', async () => {
      // Given: Sparse vectors (mostly zeros)
      const sparseVectors = [
        { vector: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], label: 'sparse1' },
        { vector: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0], label: 'sparse2' },
        { vector: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0], label: 'sparse3' }
      ];

      const sparseStore = new VectorStore({ 
        dimension: 10,
        optimizeSparse: true // Feature not implemented yet
      });
      await sparseStore.initialize();

      // When: Storing and searching sparse vectors
      for (const v of sparseVectors) {
        await sparseStore.store(v.vector, { label: v.label });
      }

      const query = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const startTime = Date.now();
      const results = await sparseStore.search(query, { k: 3 });
      const searchTime = Date.now() - startTime;

      // Then: Should use optimized calculation for better performance
      expect(results[0]!.metadata.label).toBe('sparse1');
      expect(searchTime).toBeLessThan(10); // Should be very fast for sparse vectors

      await sparseStore.close();
    });
  });
});