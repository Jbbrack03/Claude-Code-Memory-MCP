import { describe, it, expect, beforeEach } from "@jest/globals";
import { SimpleVectorIndex, createVectorIndex } from "../../src/intelligence/vector-index.js";
import type { ScalableVectorIndex, VectorDocument, SearchOptions, SearchResult } from '../../src/intelligence/vector-index.js';

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

describe('ScalableVectorIndex Interface', () => {
  describe('Type Definitions', () => {
    it('should define VectorDocument with required properties', () => {
      // Given: A valid vector document
      const doc: VectorDocument = {
        id: 'test-id',
        vector: [0.1, 0.2, 0.3],
        metadata: {
          id: 'test-id',
          workspaceId: 'workspace-1',
          timestamp: new Date(),
          customField: 'value'
        }
      };

      // Then: It should have all required properties
      expect(doc.id).toBeDefined();
      expect(doc.vector).toBeDefined();
      expect(doc.metadata).toBeDefined();
      expect(doc.metadata.workspaceId).toBeDefined();
      expect(doc.metadata.timestamp).toBeDefined();
    });

    it('should define SearchOptions with optional properties', () => {
      // Given: Various search options
      const minimalOptions: SearchOptions = {};
      const fullOptions: SearchOptions = {
        limit: 10,
        threshold: 0.8,
        filter: { workspaceId: 'workspace-1' }
      };

      // Then: Both should be valid
      expect(minimalOptions).toBeDefined();
      expect(fullOptions.limit).toBe(10);
      expect(fullOptions.threshold).toBe(0.8);
      expect(fullOptions.filter).toBeDefined();
    });

    it('should define SearchResult with document and score', () => {
      // Given: A search result
      const result: SearchResult = {
        document: {
          id: 'test-id',
          vector: [0.1, 0.2, 0.3],
          metadata: {
            id: 'test-id',
            workspaceId: 'workspace-1',
            timestamp: new Date()
          }
        },
        score: 0.95
      };

      // Then: It should have required properties
      expect(result.document).toBeDefined();
      expect(result.score).toBeDefined();
      expect(typeof result.score).toBe('number');
    });
  });

  describe('Interface Contract', () => {
    // Mock implementation for testing interface contract
    class MockScalableVectorIndex implements ScalableVectorIndex {
      async add(_document: VectorDocument): Promise<void> {
        throw new Error('Not implemented');
      }

      async addBatch(_documents: VectorDocument[]): Promise<void> {
        throw new Error('Not implemented');
      }

      async search(_query: number[], _options?: SearchOptions): Promise<SearchResult[]> {
        throw new Error('Not implemented');
      }

      async remove(_id: string): Promise<void> {
        throw new Error('Not implemented');
      }

      async clear(): Promise<void> {
        throw new Error('Not implemented');
      }

      async size(): Promise<number> {
        throw new Error('Not implemented');
      }

      async has(_id: string): Promise<boolean> {
        throw new Error('Not implemented');
      }

      async get(_id: string): Promise<VectorDocument | null> {
        throw new Error('Not implemented');
      }

      async persist(): Promise<void> {
        throw new Error('Not implemented');
      }

      async load(): Promise<void> {
        throw new Error('Not implemented');
      }
    }

    it('should implement all required methods', () => {
      // Given: An implementation of ScalableVectorIndex
      const index: ScalableVectorIndex = new MockScalableVectorIndex();

      // Then: All methods should be defined
      expect(index.add).toBeDefined();
      expect(index.addBatch).toBeDefined();
      expect(index.search).toBeDefined();
      expect(index.remove).toBeDefined();
      expect(index.clear).toBeDefined();
      expect(index.size).toBeDefined();
      expect(index.has).toBeDefined();
      expect(index.get).toBeDefined();
      expect(index.persist).toBeDefined();
      expect(index.load).toBeDefined();
    });

    it('should have methods that return promises', async () => {
      // Given: An implementation of ScalableVectorIndex
      const index = new MockScalableVectorIndex();

      // When: Calling methods (expecting them to throw)
      // Then: They should return promises
      await expect(index.add({ id: 'test', vector: [], metadata: { id: 'test', workspaceId: 'ws', timestamp: new Date() } }))
        .rejects.toThrow('Not implemented');
      await expect(index.addBatch([]))
        .rejects.toThrow('Not implemented');
      await expect(index.search([]))
        .rejects.toThrow('Not implemented');
      await expect(index.remove('test'))
        .rejects.toThrow('Not implemented');
      await expect(index.clear())
        .rejects.toThrow('Not implemented');
      await expect(index.size())
        .rejects.toThrow('Not implemented');
      await expect(index.has('test'))
        .rejects.toThrow('Not implemented');
      await expect(index.get('test'))
        .rejects.toThrow('Not implemented');
      await expect(index.persist())
        .rejects.toThrow('Not implemented');
      await expect(index.load())
        .rejects.toThrow('Not implemented');
    });
  });
});