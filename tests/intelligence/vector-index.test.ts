import { describe, it, expect, beforeEach } from "@jest/globals";
import { SimpleVectorIndex, createVectorIndex } from "../../src/intelligence/vector-index.js";

describe('SimpleVectorIndex', () => {
  let index: SimpleVectorIndex;

  beforeEach(() => {
    index = new SimpleVectorIndex();
  });

  describe('add', () => {
    it('should add vectors to the index', async () => {
      await index.add('vec1', [1, 0, 0]);
      await index.add('vec2', [0, 1, 0]);
      expect(index.size()).toBe(2);
    });

    it('should enforce dimension consistency', async () => {
      await index.add('vec1', [1, 0, 0]);
      await expect(index.add('vec2', [1, 0])).rejects.toThrow('Vector dimension mismatch');
    });

    it('should reject invalid vector values', async () => {
      await expect(index.add('vec1', [1, NaN, 0])).rejects.toThrow('Vector contains invalid values');
      await expect(index.add('vec2', [1, Infinity, 0])).rejects.toThrow('Vector contains invalid values');
      await expect(index.add('vec3', [1, -Infinity, 0])).rejects.toThrow('Vector contains invalid values');
    });

    it('should overwrite existing vectors with same ID', async () => {
      await index.add('vec1', [1, 0, 0]);
      await index.add('vec1', [0, 1, 0]);
      expect(index.size()).toBe(1);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Add test vectors
      await index.add('vec1', [1, 0, 0]);
      await index.add('vec2', [0, 1, 0]);
      await index.add('vec3', [0, 0, 1]);
      await index.add('vec4', [0.7071, 0.7071, 0]); // 45 degrees between vec1 and vec2
    });

    it('should find exact matches', async () => {
      const results = await index.search([1, 0, 0], 1);
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('vec1');
      expect(results[0]?.score).toBeCloseTo(1.0);
    });

    it('should find k nearest neighbors', async () => {
      const results = await index.search([1, 0, 0], 2);
      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe('vec1');
      expect(results[1]?.id).toBe('vec4');
    });

    it('should return all vectors when k > size', async () => {
      const results = await index.search([1, 0, 0], 10);
      expect(results).toHaveLength(4);
    });

    it('should handle orthogonal vectors', async () => {
      const results = await index.search([1, 0, 0], 4);
      const vec2Result = results.find(r => r.id === 'vec2');
      const vec3Result = results.find(r => r.id === 'vec3');
      expect(vec2Result?.score).toBeCloseTo(0);
      expect(vec3Result?.score).toBeCloseTo(0);
    });

    it('should return empty array for empty index', async () => {
      const emptyIndex = new SimpleVectorIndex();
      const results = await emptyIndex.search([1, 0, 0], 5);
      expect(results).toEqual([]);
    });

    it('should validate query dimension', async () => {
      await expect(index.search([1, 0], 1)).rejects.toThrow('Query dimension mismatch');
    });

    it('should handle negative similarity correctly', async () => {
      await index.add('opposite', [-1, 0, 0]);
      const results = await index.search([1, 0, 0], 5);
      const oppositeResult = results.find(r => r.id === 'opposite');
      expect(oppositeResult?.score).toBeCloseTo(-1);
    });
  });

  describe('remove', () => {
    it('should remove vectors from the index', async () => {
      await index.add('vec1', [1, 0, 0]);
      await index.add('vec2', [0, 1, 0]);
      expect(index.size()).toBe(2);
      
      await index.remove('vec1');
      expect(index.size()).toBe(1);
      
      const results = await index.search([1, 0, 0], 2);
      expect(results.find(r => r.id === 'vec1')).toBeUndefined();
    });

    it('should handle removing non-existent vectors', async () => {
      await index.remove('non-existent');
      expect(index.size()).toBe(0);
    });
  });

  describe('size', () => {
    it('should return correct size', async () => {
      expect(index.size()).toBe(0);
      
      await index.add('vec1', [1, 0, 0]);
      expect(index.size()).toBe(1);
      
      await index.add('vec2', [0, 1, 0]);
      expect(index.size()).toBe(2);
      
      await index.remove('vec1');
      expect(index.size()).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle zero vectors', async () => {
      await index.add('zero', [0, 0, 0]);
      const results = await index.search([1, 0, 0], 1);
      expect(results[0]?.score).toBe(0);
    });

    it('should handle high-dimensional vectors', async () => {
      const dim = 1000;
      const vec1 = new Array(dim).fill(0);
      vec1[0] = 1;
      const vec2 = new Array(dim).fill(0);
      vec2[1] = 1;
      
      await index.add('high1', vec1);
      await index.add('high2', vec2);
      
      const results = await index.search(vec1, 2);
      expect(results[0]?.id).toBe('high1');
      expect(results[0]?.score).toBeCloseTo(1);
    });

    it('should maintain numerical stability', async () => {
      const smallVec = [1e-10, 1e-10, 1e-10];
      const largeVec = [1e10, 1e10, 1e10];
      
      await index.add('small', smallVec);
      await index.add('large', largeVec);
      
      const results1 = await index.search(smallVec, 2);
      const results2 = await index.search(largeVec, 2);
      
      expect(results1[0]?.score).toBeCloseTo(1);
      expect(results2[0]?.score).toBeCloseTo(1);
    });
  });
});

describe('createVectorIndex', () => {
  it('should create SimpleVectorIndex by default', () => {
    const index = createVectorIndex();
    expect(index).toBeInstanceOf(SimpleVectorIndex);
  });

  it('should create SimpleVectorIndex when type is "simple"', () => {
    const index = createVectorIndex('simple');
    expect(index).toBeInstanceOf(SimpleVectorIndex);
  });

  it('should throw error for unknown types', () => {
    expect(() => createVectorIndex('unknown' as any)).toThrow('Unknown vector index type: unknown');
  });
});