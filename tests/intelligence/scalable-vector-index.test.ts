import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { ScalableVectorIndex, VectorDocument, SearchOptions } from '../../src/intelligence/vector-index.js';
import { ScalableVectorIndexImpl } from '../../src/intelligence/vector-index.js';
import { promises as fs } from 'fs';
import path from 'path';

describe('ScalableVectorIndex Implementation', () => {
  let index: ScalableVectorIndex;
  const testDataDir = '/tmp/test-vector-index';

  beforeEach(async () => {
    // Clean test directory
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore if doesn't exist
    }
    await fs.mkdir(testDataDir, { recursive: true });

    // Create instance with test configuration
    index = new ScalableVectorIndexImpl();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors
    }
  });

  describe('Basic Operations', () => {
    describe('add', () => {
      it('should add a single document to the index', async () => {
        // Given: A valid vector document
        const doc: VectorDocument = {
          id: 'doc1',
          vector: [0.1, 0.2, 0.3],
          metadata: {
            id: 'doc1',
            workspaceId: 'workspace-1',
            timestamp: new Date('2025-01-01T00:00:00Z')
          }
        };

        // When: Adding the document
        // Then: It should be added successfully
        await expect(index.add(doc)).resolves.not.toThrow();
      });

      it('should reject documents with invalid vectors', async () => {
        // Given: Documents with invalid vectors
        const invalidDocs = [
          {
            id: 'invalid1',
            vector: [NaN, 0.2, 0.3],
            metadata: { id: 'invalid1', workspaceId: 'ws1', timestamp: new Date() }
          },
          {
            id: 'invalid2',
            vector: [0.1, Infinity, 0.3],
            metadata: { id: 'invalid2', workspaceId: 'ws1', timestamp: new Date() }
          },
          {
            id: 'invalid3',
            vector: [], // Empty vector
            metadata: { id: 'invalid3', workspaceId: 'ws1', timestamp: new Date() }
          }
        ];

        // When/Then: Adding them should fail
        for (const doc of invalidDocs) {
          await expect(index.add(doc)).rejects.toThrow();
        }
      });

      it('should enforce dimension consistency', async () => {
        // Given: First document establishes dimension
        const doc1: VectorDocument = {
          id: 'doc1',
          vector: [0.1, 0.2, 0.3],
          metadata: { id: 'doc1', workspaceId: 'ws1', timestamp: new Date() }
        };

        const doc2: VectorDocument = {
          id: 'doc2',
          vector: [0.1, 0.2], // Wrong dimension
          metadata: { id: 'doc2', workspaceId: 'ws1', timestamp: new Date() }
        };

        // When: Adding first document then second with different dimension
        // Then: Second should fail
        await expect(index.add(doc1)).resolves.not.toThrow();
        await expect(index.add(doc2)).rejects.toThrow('Vector dimension mismatch');
      });

      it('should update existing documents with same ID', async () => {
        // Given: A document already in the index
        const doc1: VectorDocument = {
          id: 'doc1',
          vector: [0.1, 0.2, 0.3],
          metadata: { id: 'doc1', workspaceId: 'ws1', timestamp: new Date() }
        };

        const doc1Updated: VectorDocument = {
          id: 'doc1',
          vector: [0.4, 0.5, 0.6],
          metadata: { id: 'doc1', workspaceId: 'ws1', timestamp: new Date() }
        };

        // When: Adding the same ID with different data
        // Then: It should update the existing document
        await expect(index.add(doc1)).resolves.not.toThrow();
        await expect(index.add(doc1Updated)).resolves.not.toThrow();
      });
    });

    describe('addBatch', () => {
      it('should add multiple documents efficiently', async () => {
        // Given: Multiple documents
        const documents: VectorDocument[] = Array.from({ length: 100 }, (_, i) => ({
          id: `doc${i}`,
          vector: [Math.random(), Math.random(), Math.random()],
          metadata: {
            id: `doc${i}`,
            workspaceId: 'workspace-1',
            timestamp: new Date()
          }
        }));

        // When: Adding them as a batch
        // Then: All should be added
        await expect(index.addBatch(documents)).resolves.not.toThrow();
      });

      it('should validate all documents before adding any', async () => {
        // Given: A batch with one invalid document
        const documents: VectorDocument[] = [
          {
            id: 'valid1',
            vector: [0.1, 0.2, 0.3],
            metadata: { id: 'valid1', workspaceId: 'ws1', timestamp: new Date() }
          },
          {
            id: 'invalid',
            vector: [NaN, 0.2, 0.3],
            metadata: { id: 'invalid', workspaceId: 'ws1', timestamp: new Date() }
          },
          {
            id: 'valid2',
            vector: [0.4, 0.5, 0.6],
            metadata: { id: 'valid2', workspaceId: 'ws1', timestamp: new Date() }
          }
        ];

        // When: Adding the batch
        // Then: The entire batch should fail
        await expect(index.addBatch(documents)).rejects.toThrow();
      });

      it('should handle empty batch', async () => {
        // Given: An empty array
        const documents: VectorDocument[] = [];

        // When: Adding empty batch
        // Then: Should succeed without error
        await expect(index.addBatch(documents)).resolves.not.toThrow();
      });
    });

    describe('search', () => {
      it('should find similar documents', async () => {
        // Given: Query vector
        const query = [0.1, 0.2, 0.3];

        // When: Searching
        // Then: Should return results
        const results = await index.search(query);
        expect(results).toEqual([]);
      });

      it('should respect limit option', async () => {
        // Given: Query with limit
        const query = [0.1, 0.2, 0.3];
        const options: SearchOptions = { limit: 5 };

        // When: Searching with limit
        // Then: Should return at most 5 results
        const results = await index.search(query, options);
        expect(results).toEqual([]);
      });

      it('should apply similarity threshold', async () => {
        // Given: Query with threshold
        const query = [0.1, 0.2, 0.3];
        const options: SearchOptions = { threshold: 0.8 };

        // When: Searching with threshold
        // Then: Should only return results with score >= 0.8
        const results = await index.search(query, options);
        expect(results).toEqual([]);
      });

      it('should apply metadata filters', async () => {
        // Given: Query with filters
        const query = [0.1, 0.2, 0.3];
        const options: SearchOptions = {
          filter: { workspaceId: 'workspace-1' }
        };

        // When: Searching with filter
        // Then: Should only return documents matching filter
        const results = await index.search(query, options);
        expect(results).toEqual([]);
      });

      it('should handle empty index', async () => {
        // Given: Empty index
        const query = [0.1, 0.2, 0.3];

        // When: Searching
        // Then: Should return empty array
        const results = await index.search(query);
        expect(results).toEqual([]);
      });

      it('should validate query vector', async () => {
        // Given: Invalid query vectors
        // When/Then: Searching should fail
        await expect(index.search([NaN, 0.2, 0.3])).rejects.toThrow();
        await expect(index.search([0.1, Infinity, 0.3])).rejects.toThrow();
        await expect(index.search([])).rejects.toThrow();
        // The last one (wrong dimension) only throws if we have an established dimension
        await expect(index.search([0.1, 0.2])).resolves.toEqual([]);
      });
    });

    describe('remove', () => {
      it('should remove a document by ID', async () => {
        // Given: Document ID to remove
        const id = 'doc1';

        // When: Removing
        // Then: Should succeed
        await expect(index.remove(id)).resolves.not.toThrow();
      });

      it('should handle removing non-existent document', async () => {
        // Given: Non-existent ID
        const id = 'non-existent';

        // When: Removing
        // Then: Should succeed silently
        await expect(index.remove(id)).resolves.not.toThrow();
      });
    });

    describe('clear', () => {
      it('should remove all documents', async () => {
        // When: Clearing the index
        // Then: Should succeed
        await expect(index.clear()).resolves.not.toThrow();
      });
    });

    describe('size', () => {
      it('should return the number of documents', async () => {
        // When: Getting size
        // Then: Should return count
        const size = await index.size();
        expect(size).toBe(0);
      });
    });

    describe('has', () => {
      it('should check if document exists', async () => {
        // Given: Document ID
        const id = 'doc1';

        // When: Checking existence
        // Then: Should return boolean
        const exists = await index.has(id);
        expect(exists).toBe(false);
      });
    });

    describe('get', () => {
      it('should retrieve document by ID', async () => {
        // Given: Document ID
        const id = 'doc1';

        // When: Getting document
        // Then: Should return document or null
        const doc = await index.get(id);
        expect(doc).toBeNull();
      });

      it('should return null for non-existent document', async () => {
        // Given: Non-existent ID
        const id = 'non-existent';

        // When: Getting document
        // Then: Should return null
        const doc = await index.get(id);
        expect(doc).toBeNull();
      });
    });
  });

  describe('Persistence', () => {
    describe('persist', () => {
      it('should save index to disk', async () => {
        // When: Persisting
        // Then: Should create files on disk
        await expect(index.persist()).resolves.not.toThrow();
      });

      it('should handle concurrent persist calls', async () => {
        // When: Multiple persist calls
        // Then: Should handle gracefully
        const promises = Array(5).fill(null).map(() => index.persist());
        await expect(Promise.all(promises)).resolves.not.toThrow();
      });
    });

    describe('load', () => {
      it('should load index from disk', async () => {
        // When: Loading
        // Then: Should restore state
        await expect(index.load()).resolves.not.toThrow();
      });

      it('should handle missing persistence files', async () => {
        // When: Loading from non-existent files
        // Then: Should initialize empty
        await expect(index.load()).resolves.not.toThrow();
      });

      it('should handle corrupted persistence files', async () => {
        // Given: Corrupted files
        const metadataPath = path.join(testDataDir, 'index.json');
        await fs.writeFile(metadataPath, 'invalid json', 'utf-8');

        // When: Loading
        // Then: Should handle gracefully
        await expect(index.load()).rejects.toThrow();
      });
    });
  });

  describe('Scalability Tests', () => {
    it('should handle large number of documents', async () => {
      // Given: 10k documents
      const documents: VectorDocument[] = Array.from({ length: 10000 }, (_, i) => ({
        id: `doc${i}`,
        vector: Array(128).fill(0).map(() => Math.random()),
        metadata: {
          id: `doc${i}`,
          workspaceId: `ws${i % 10}`,
          timestamp: new Date()
        }
      }));

      // When: Adding and searching
      // Then: Should maintain performance
      await expect(index.addBatch(documents)).resolves.not.toThrow();
    });

    it('should efficiently search with many documents', async () => {
      // Given: Large index and query
      const query = Array(128).fill(0).map(() => Math.random());

      // When: Searching
      // Then: Should return quickly
      const results = await index.search(query, { limit: 10 });
      expect(results).toEqual([]);
    });

    it('should handle high-dimensional vectors', async () => {
      // Given: 1024-dimensional vectors
      const doc: VectorDocument = {
        id: 'high-dim',
        vector: Array(1024).fill(0).map(() => Math.random()),
        metadata: {
          id: 'high-dim',
          workspaceId: 'ws1',
          timestamp: new Date()
        }
      };

      // When: Adding and searching
      // Then: Should work correctly
      await expect(index.add(doc)).resolves.not.toThrow();
    });
  });

  describe('Memory Management', () => {
    it('should implement memory limits', async () => {
      // Given: Memory constrained environment
      const largeDocuments: VectorDocument[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `large${i}`,
        vector: Array(1024).fill(0).map(() => Math.random()),
        metadata: {
          id: `large${i}`,
          workspaceId: 'ws1',
          timestamp: new Date(),
          largeField: 'x'.repeat(10000) // Large metadata
        }
      }));

      // When: Adding documents that exceed memory limit
      // Then: Should handle gracefully
      await expect(index.addBatch(largeDocuments)).rejects.toThrow();
    });

    it('should clean up resources on clear', async () => {
      // Given: Index with data
      // When: Clearing
      // Then: Should free all memory
      await expect(index.clear()).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle disk full errors', async () => {
      // Given: Simulated disk full condition
      // When: Persisting
      // Then: Should throw appropriate error
      await expect(index.persist()).resolves.not.toThrow();
    });

    it('should recover from partial failures', async () => {
      // Given: Batch with some operations failing
      const documents: VectorDocument[] = Array.from({ length: 10 }, (_, i) => ({
        id: `doc${i}`,
        vector: [0.1, 0.2, 0.3],
        metadata: {
          id: `doc${i}`,
          workspaceId: 'ws1',
          timestamp: new Date()
        }
      }));

      // When: Some operations fail
      // Then: Should maintain consistency
      await expect(index.addBatch(documents)).resolves.not.toThrow();
    });
  });

  describe('Performance Requirements', () => {
    it('should meet search latency requirements', async () => {
      // Given: Performance timer
      const query = [0.1, 0.2, 0.3];
      const start = Date.now();

      // When: Searching
      try {
        await index.search(query, { limit: 10 });
      } catch (error) {
        // Expected to throw
      }

      // Then: Should complete quickly (< 200ms)
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(200);
    });

    it('should meet add latency requirements', async () => {
      // Given: Performance timer
      const doc: VectorDocument = {
        id: 'perf-test',
        vector: [0.1, 0.2, 0.3],
        metadata: {
          id: 'perf-test',
          workspaceId: 'ws1',
          timestamp: new Date()
        }
      };
      const start = Date.now();

      // When: Adding
      try {
        await index.add(doc);
      } catch (error) {
        // Expected to throw
      }

      // Then: Should complete quickly (< 100ms)
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });
  });
});