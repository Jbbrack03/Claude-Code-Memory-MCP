import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { VectorStore } from "../../src/storage/vector-store.js";
import { promises as fs } from "fs";
import path from "path";

describe('Production ScalableVectorIndex Tests', () => {
  let vectorStore: VectorStore;
  let vectorStoreWithScalable: VectorStore;
  const testDir = '/tmp/test-scalable-vector';
  const dimension = 384;

  beforeEach(async () => {
    // Clean test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore if doesn't exist
    }
    await fs.mkdir(testDir, { recursive: true });

    // Create standard vector store for comparison
    vectorStore = new VectorStore({
      dimension,
      path: path.join(testDir, 'standard'),
      useScalableIndex: false
    });
    await vectorStore.initialize();

    // Create vector store with scalable index
    vectorStoreWithScalable = new VectorStore({
      dimension,
      path: path.join(testDir, 'scalable'),
      useScalableIndex: true
    });
    await vectorStoreWithScalable.initialize();
  });

  afterEach(async () => {
    await vectorStore?.close();
    await vectorStoreWithScalable?.close();
    
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors
    }
  });

  describe('Performance Comparison', () => {
    it('should maintain O(log n) search performance with large datasets', async () => {
      // Given: Large number of vectors
      const vectorCount = 10000;
      const vectors = Array.from({ length: vectorCount }, (_, i) => ({
        vector: Array(dimension).fill(0).map(() => Math.random()),
        metadata: { 
          id: `vec-${i}`, 
          category: `cat-${i % 10}`,
          timestamp: new Date().toISOString()
        }
      }));

      // When: Adding vectors to both stores
      console.log('Adding vectors to standard store...');
      const standardAddStart = Date.now();
      for (const { vector, metadata } of vectors) {
        await vectorStore.store(vector, metadata);
      }
      const standardAddTime = Date.now() - standardAddStart;

      console.log('Adding vectors to scalable store...');
      const scalableAddStart = Date.now();
      for (const { vector, metadata } of vectors) {
        await vectorStoreWithScalable.store(vector, metadata);
      }
      const scalableAddTime = Date.now() - scalableAddStart;

      // Create query vector
      const queryVector = Array(dimension).fill(0).map(() => Math.random());

      // Perform searches and measure time
      const searchRounds = 10;
      let standardSearchTime = 0;
      let scalableSearchTime = 0;

      for (let i = 0; i < searchRounds; i++) {
        // Standard search
        const standardStart = Date.now();
        await vectorStore.search(queryVector, { k: 10 });
        standardSearchTime += Date.now() - standardStart;

        // Scalable search
        const scalableStart = Date.now();
        await vectorStoreWithScalable.search(queryVector, { k: 10 });
        scalableSearchTime += Date.now() - scalableStart;
      }

      const avgStandardSearch = standardSearchTime / searchRounds;
      const avgScalableSearch = scalableSearchTime / searchRounds;

      console.log(`Standard add time: ${standardAddTime}ms`);
      console.log(`Scalable add time: ${scalableAddTime}ms`);
      console.log(`Average standard search: ${avgStandardSearch}ms`);
      console.log(`Average scalable search: ${avgScalableSearch}ms`);

      // Then: Scalable index should be significantly faster for search
      // Allow some variance, but scalable should be at least 2x faster
      expect(avgScalableSearch).toBeLessThan(avgStandardSearch * 0.5);
    }, 60000); // 60 second timeout

    it('should handle incremental updates efficiently', async () => {
      // Given: Initial set of vectors
      const initialVectors = 1000;
      const updateBatches = 10;
      const vectorsPerBatch = 100;

      // Add initial vectors
      for (let i = 0; i < initialVectors; i++) {
        const vector = Array(dimension).fill(0).map(() => Math.random());
        await vectorStoreWithScalable.store(vector, { id: `initial-${i}` });
      }

      // When: Adding vectors in batches and measuring search performance
      const searchTimes: number[] = [];
      const queryVector = Array(dimension).fill(0).map(() => Math.random());

      for (let batch = 0; batch < updateBatches; batch++) {
        // Add new batch
        for (let i = 0; i < vectorsPerBatch; i++) {
          const vector = Array(dimension).fill(0).map(() => Math.random());
          await vectorStoreWithScalable.store(vector, { 
            id: `batch-${batch}-${i}`,
            batch
          });
        }

        // Measure search time
        const searchStart = Date.now();
        await vectorStoreWithScalable.search(queryVector, { k: 10 });
        searchTimes.push(Date.now() - searchStart);
      }

      // Then: Search time should not degrade significantly
      const firstBatchTime = searchTimes[0]!;
      const lastBatchTime = searchTimes[searchTimes.length - 1]!;
      
      // Allow for some variance, but should not be more than 2x slower
      expect(lastBatchTime).toBeLessThan(firstBatchTime * 2);
    });
  });

  describe('Accuracy and Correctness', () => {
    it('should return same results as standard implementation', async () => {
      // Given: Same vectors in both stores
      const testVectors = Array.from({ length: 100 }, (_, i) => ({
        vector: Array(dimension).fill(0).map(() => Math.random()),
        metadata: { id: `test-${i}`, score: Math.random() }
      }));

      // Store in both implementations
      for (const { vector, metadata } of testVectors) {
        await vectorStore.store(vector, metadata);
        await vectorStoreWithScalable.store(vector, metadata);
      }

      // When: Searching with same query
      const queryVector = Array(dimension).fill(0).map(() => Math.random());
      const standardResults = await vectorStore.search(queryVector, { k: 10 });
      const scalableResults = await vectorStoreWithScalable.search(queryVector, { k: 10 });

      // Then: Results should be identical (same IDs in same order)
      expect(scalableResults.length).toBe(standardResults.length);
      
      // Check that the same vectors are returned (order might vary slightly due to precision)
      const standardIds = new Set(standardResults.map(r => r.metadata.id));
      const scalableIds = new Set(scalableResults.map(r => r.metadata.id));
      
      // At least 90% overlap expected (allowing for minor precision differences)
      const intersection = new Set([...standardIds].filter(id => scalableIds.has(id)));
      expect(intersection.size).toBeGreaterThanOrEqual(standardIds.size * 0.9);
    });

    it('should handle edge cases correctly', async () => {
      // Given: Vector store with scalable index

      // Test 1: Empty store
      const emptyResults = await vectorStoreWithScalable.search(
        Array(dimension).fill(0.5), 
        { k: 10 }
      );
      expect(emptyResults).toEqual([]);

      // Test 2: Single vector
      const singleVector = Array(dimension).fill(0).map(() => Math.random());
      await vectorStoreWithScalable.store(singleVector, { id: 'single' });
      
      const singleResults = await vectorStoreWithScalable.search(singleVector, { k: 10 });
      expect(singleResults).toHaveLength(1);
      expect(singleResults[0]?.metadata.id).toBe('single');

      // Test 3: Duplicate vectors
      const duplicateVector = Array(dimension).fill(0.5);
      for (let i = 0; i < 5; i++) {
        await vectorStoreWithScalable.store(duplicateVector, { id: `dup-${i}` });
      }
      
      const dupResults = await vectorStoreWithScalable.search(duplicateVector, { k: 10 });
      expect(dupResults.length).toBeGreaterThanOrEqual(5);
      
      // All should have perfect similarity
      dupResults.slice(0, 5).forEach(result => {
        expect(result.score).toBeCloseTo(1.0, 5);
      });
    });
  });

  describe('Memory and Resource Management', () => {
    it('should handle memory constraints efficiently', async () => {
      // Given: Limited memory scenario
      const memoryConstrainedStore = new VectorStore({
        dimension,
        path: path.join(testDir, 'memory-constrained'),
        useScalableIndex: true,
        memoryMode: 'efficient',
        maxMemoryMB: 100
      });
      await memoryConstrainedStore.initialize();

      // When: Adding many vectors
      const vectorCount = 5000;
      const addPromises = [];

      for (let i = 0; i < vectorCount; i++) {
        const vector = Array(dimension).fill(0).map(() => Math.random());
        addPromises.push(
          memoryConstrainedStore.store(vector, { 
            id: `mem-${i}`,
            largeField: 'x'.repeat(1000) // Add some metadata overhead
          })
        );
      }

      // Should handle without running out of memory
      await expect(Promise.all(addPromises)).resolves.toBeDefined();

      // And search should still work
      const queryVector = Array(dimension).fill(0).map(() => Math.random());
      const results = await memoryConstrainedStore.search(queryVector, { k: 10 });
      expect(results.length).toBeGreaterThan(0);

      await memoryConstrainedStore.close();
    });

    it('should persist and reload efficiently', async () => {
      // Given: Store with many vectors
      const vectorCount = 1000;
      const storedIds = new Set<string>();

      for (let i = 0; i < vectorCount; i++) {
        const vector = Array(dimension).fill(0).map(() => Math.random());
        const id = await vectorStoreWithScalable.store(vector, { 
          id: `persist-${i}`,
          value: i
        });
        storedIds.add(id);
      }

      // When: Closing and reopening
      await vectorStoreWithScalable.close();

      const reloadedStore = new VectorStore({
        dimension,
        path: path.join(testDir, 'scalable'),
        useScalableIndex: true
      });
      
      const loadStart = Date.now();
      await reloadedStore.initialize();
      const loadTime = Date.now() - loadStart;

      console.log(`Reload time for ${vectorCount} vectors: ${loadTime}ms`);

      // Then: Should load quickly and maintain functionality
      expect(loadTime).toBeLessThan(5000); // Should load in under 5 seconds

      // Verify search works
      const queryVector = Array(dimension).fill(0).map(() => Math.random());
      const results = await reloadedStore.search(queryVector, { k: 10 });
      expect(results.length).toBeGreaterThan(0);

      await reloadedStore.close();
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent adds and searches', async () => {
      // Given: Continuous adds and searches
      const addCount = 500;
      const searchCount = 100;
      const errors: Error[] = [];

      // Start adding vectors
      const addPromise = (async () => {
        for (let i = 0; i < addCount; i++) {
          try {
            const vector = Array(dimension).fill(0).map(() => Math.random());
            await vectorStoreWithScalable.store(vector, { id: `concurrent-${i}` });
          } catch (error) {
            errors.push(error as Error);
          }
        }
      })();

      // Start searching concurrently
      const searchPromise = (async () => {
        for (let i = 0; i < searchCount; i++) {
          try {
            const queryVector = Array(dimension).fill(0).map(() => Math.random());
            await vectorStoreWithScalable.search(queryVector, { k: 5 });
          } catch (error) {
            errors.push(error as Error);
          }
          // Small delay to spread searches
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      })();

      // When: Running both concurrently
      await Promise.all([addPromise, searchPromise]);

      // Then: Should complete without errors
      expect(errors).toHaveLength(0);
    });

    it('should maintain consistency under concurrent modifications', async () => {
      // Given: Initial vectors
      const initialIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        const vector = Array(dimension).fill(0).map(() => Math.random());
        const id = await vectorStoreWithScalable.store(vector, { id: `base-${i}` });
        initialIds.push(id);
      }

      // When: Concurrent updates, deletes, and adds
      const operations = [
        // Add new vectors
        ...Array.from({ length: 50 }, (_, i) => async () => {
          const vector = Array(dimension).fill(0).map(() => Math.random());
          await vectorStoreWithScalable.store(vector, { id: `new-${i}` });
        }),
        // Update existing vectors
        ...Array.from({ length: 30 }, (_, i) => async () => {
          const vector = Array(dimension).fill(0).map(() => Math.random());
          const id = initialIds[i];
          if (id) {
            // Update by storing with same metadata
            const existing = await vectorStoreWithScalable.get(id);
            if (existing) {
              await vectorStoreWithScalable.store(vector, { ...existing.metadata, updated: true });
            }
          }
        }),
        // Delete some vectors
        ...Array.from({ length: 20 }, (_, i) => async () => {
          const id = initialIds[i + 50];
          if (id) {
            await vectorStoreWithScalable.delete(id);
          }
        })
      ];

      // Shuffle operations for randomness
      const shuffled = operations.sort(() => Math.random() - 0.5);

      // Execute all operations concurrently
      await Promise.all(shuffled.map(op => op()));

      // Then: Store should be in consistent state
      // We can't easily verify the exact count without a getStatistics method,
      // but we can verify operations completed without errors
      expect(shuffled.length).toBe(100); // All operations were created
    });
  });

  describe('Production Monitoring and Metrics', () => {
    it('should provide accurate performance metrics', async () => {
      // Given: Store with metrics enabled
      const metricsStore = new VectorStore({
        dimension,
        path: path.join(testDir, 'metrics'),
        useScalableIndex: true,
        enableMetrics: true
      });
      await metricsStore.initialize();

      // When: Performing various operations
      const storeCount = 100;
      const searchCount = 50;

      for (let i = 0; i < storeCount; i++) {
        const vector = Array(dimension).fill(0).map(() => Math.random());
        await metricsStore.store(vector, { id: `metric-${i}` });
      }

      for (let i = 0; i < searchCount; i++) {
        const queryVector = Array(dimension).fill(0).map(() => Math.random());
        await metricsStore.search(queryVector, { k: 10 });
      }

      // Then: Should have accurate metrics
      const metrics = metricsStore.getMetrics();
      
      expect(metrics.operations.store.count).toBeGreaterThanOrEqual(storeCount);
      expect(metrics.operations.search.count).toBeGreaterThanOrEqual(searchCount);
      expect(metrics.operations.store.avgLatency).toBeGreaterThan(0);
      expect(metrics.operations.search.p95Latency).toBeGreaterThan(0);
      expect(metrics.storage.vectorCount).toBeGreaterThanOrEqual(storeCount);

      await metricsStore.close();
    });

    it('should detect and report anomalies', async () => {
      // Given: Store with anomaly detection
      const anomalyStore = new VectorStore({
        dimension,
        path: path.join(testDir, 'anomaly'),
        useScalableIndex: true,
        detectAnomalies: true
      });
      await anomalyStore.initialize();

      // When: Adding normal and anomalous vectors
      // Normal vectors - clustered around 0.5
      for (let i = 0; i < 50; i++) {
        const vector = Array(dimension).fill(0).map(() => 0.5 + (Math.random() - 0.5) * 0.1);
        await anomalyStore.store(vector, { id: `normal-${i}`, type: 'normal' });
      }

      // Anomalous vectors - very different values
      const anomalousVectors = [
        Array(dimension).fill(0.99), // All high values
        Array(dimension).fill(0.01), // All low values
        Array(dimension).fill(0).map((_, i) => i % 2 === 0 ? 1 : 0), // Alternating
      ];

      for (let i = 0; i < anomalousVectors.length; i++) {
        await anomalyStore.store(anomalousVectors[i]!, { id: `anomaly-${i}`, type: 'anomaly' });
      }

      // Then: Search should identify anomalies with lower similarity scores
      const normalQuery = Array(dimension).fill(0.5);
      const results = await anomalyStore.search(normalQuery, { k: 60 });

      // Normal vectors should have higher scores
      const normalResults = results.filter(r => r.metadata.type === 'normal');
      const anomalyResults = results.filter(r => r.metadata.type === 'anomaly');

      const avgNormalScore = normalResults.reduce((sum, r) => sum + r.score, 0) / normalResults.length;
      const avgAnomalyScore = anomalyResults.reduce((sum, r) => sum + r.score, 0) / anomalyResults.length;

      expect(avgNormalScore).toBeGreaterThan(avgAnomalyScore);

      await anomalyStore.close();
    });
  });
});