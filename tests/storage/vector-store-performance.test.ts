import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { VectorStore } from "../../src/storage/vector-store.js";
import fs from "fs";
import path from "path";

describe('VectorStore - Performance and Edge Cases', () => {
  let store: VectorStore;
  const testPath = path.join(process.cwd(), '.test-memory', 'vector-perf-test');

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

  describe('performance requirements', () => {
    it('should meet search latency requirements (< 200ms p95)', async () => {
      // Given: Store with realistic dataset
      store = new VectorStore({ dimension: 384 });
      await store.initialize();

      // Generate 10,000 vectors
      const vectors = Array(10000).fill(null).map((_, i) => ({
        vector: Array(384).fill(0).map(() => Math.random() - 0.5),
        metadata: {
          id: i,
          project: `project_${i % 10}`,
          type: ['commit', 'file', 'test'][i % 3]!,
          timestamp: Date.now() + i
        }
      }));
      await store.storeBatch(vectors);

      // When: Performing 100 searches
      const searchLatencies: number[] = [];
      for (let i = 0; i < 100; i++) {
        const queryVector = Array(384).fill(0).map(() => Math.random() - 0.5);
        const startTime = Date.now();
        await store.search(queryVector, { k: 10 });
        searchLatencies.push(Date.now() - startTime);
      }

      // Then: Calculate p95 latency
      searchLatencies.sort((a, b) => a - b);
      const p95Index = Math.floor(searchLatencies.length * 0.95);
      const p95Latency = searchLatencies[p95Index]!;

      expect(p95Latency).toBeLessThan(200); // Requirement from CLAUDE.md
      
      // Also check p99
      const p99Index = Math.floor(searchLatencies.length * 0.99);
      const p99Latency = searchLatencies[p99Index]!;
      expect(p99Latency).toBeLessThan(300); // Allow some headroom for p99
    });

    it('should meet insertion rate requirements', async () => {
      // Given: Store optimized for insertions
      store = new VectorStore({ 
        dimension: 384,
        optimizeForWrites: true // Feature not implemented yet
      });
      await store.initialize();

      // When: Inserting vectors at high rate
      const numVectors = 1000;
      const startTime = Date.now();
      
      const promises = [];
      for (let i = 0; i < numVectors; i++) {
        const vector = Array(384).fill(0).map(() => Math.random());
        promises.push(store.store(vector, { index: i }));
      }
      
      await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // Then: Should achieve high insertion rate
      const insertionsPerSecond = (numVectors / totalTime) * 1000;
      expect(insertionsPerSecond).toBeGreaterThan(500); // At least 500 vectors/second
    });

    it('should scale search performance with concurrent queries', async () => {
      // Given: Store with dataset
      store = new VectorStore({ 
        dimension: 128,
        maxConcurrentSearches: 10 // Feature not implemented yet
      });
      await store.initialize();

      // Add 5000 vectors
      const vectors = Array(5000).fill(null).map(() => ({
        vector: Array(128).fill(0).map(() => Math.random()),
        metadata: {}
      }));
      await store.storeBatch(vectors);

      // When: Running concurrent searches
      const concurrentSearches = 20;
      const queries = Array(concurrentSearches).fill(null).map(() => 
        Array(128).fill(0).map(() => Math.random())
      );

      const startTime = Date.now();
      const results = await Promise.all(
        queries.map(q => store.search(q, { k: 10 }))
      );
      const totalTime = Date.now() - startTime;

      // Then: Should handle concurrency efficiently
      expect(results).toHaveLength(concurrentSearches);
      expect(results.every(r => r.length === 10)).toBe(true);
      
      // Average time per search should be reasonable
      const avgTimePerSearch = totalTime / concurrentSearches;
      expect(avgTimePerSearch).toBeLessThan(100);
    });

    it('should optimize memory usage for large datasets', async () => {
      // Given: Store with memory optimization
      store = new VectorStore({ 
        dimension: 768,
        path: testPath,
        memoryMode: 'efficient', // Feature not implemented yet
        maxMemoryMB: 100
      });
      await store.initialize();

      // Track memory before
      const memBefore = process.memoryUsage().heapUsed;

      // When: Adding large dataset
      const batchSize = 1000;
      for (let batch = 0; batch < 10; batch++) {
        const vectors = Array(batchSize).fill(null).map(() => ({
          vector: Array(768).fill(0).map(() => Math.random()),
          metadata: { batch }
        }));
        await store.storeBatch(vectors);
      }

      // Then: Memory usage should be controlled
      const memAfter = process.memoryUsage().heapUsed;
      const memIncreaseGB = (memAfter - memBefore) / (1024 * 1024 * 1024);
      
      expect(memIncreaseGB).toBeLessThan(0.5); // Less than 500MB increase
      
      // Should still perform well
      const searchStart = Date.now();
      await store.search(Array(768).fill(0.5), { k: 10 });
      const searchTime = Date.now() - searchStart;
      expect(searchTime).toBeLessThan(200);
    });
  });

  describe('edge cases', () => {
    beforeEach(async () => {
      store = new VectorStore({ dimension: 3 });
      await store.initialize();
    });

    it('should handle duplicate vectors gracefully', async () => {
      // Given: Identical vectors
      const vector = [0.5, 0.5, 0.5];
      
      // When: Storing duplicates
      const id1 = await store.store(vector, { version: 1 });
      const id2 = await store.store(vector, { version: 2 });
      const id3 = await store.store(vector, { version: 3 });

      // Then: All should be stored separately
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);

      // Search should return all
      const results = await store.search(vector, { k: 10 });
      expect(results).toHaveLength(3);
      expect(results.every(r => r.score === 1.0)).toBe(true);
    });

    it('should handle very small vector values', async () => {
      // Given: Vectors with very small values (near epsilon)
      const epsilon = 1e-10;
      await store.store([epsilon, epsilon, epsilon], { label: 'tiny' });
      await store.store([1, 0, 0], { label: 'normal' });

      // When: Searching with tiny vector
      const results = await store.search([epsilon, epsilon, epsilon], { k: 2 });

      // Then: Should handle numerical precision correctly
      expect(results[0]!.metadata.label).toBe('tiny');
      expect(results[0]!.score).toBeCloseTo(1.0, 5);
    });

    it('should handle very large vector values', async () => {
      // Given: Vectors with large values
      const large = 1e6;
      await store.store([large, 0, 0], { label: 'large-x' });
      await store.store([0, large, 0], { label: 'large-y' });
      await store.store([1, 0, 0], { label: 'normal' });

      // When: Searching with large vector
      const results = await store.search([large, 0, 0], { k: 3 });

      // Then: Should normalize correctly
      expect(results[0]!.metadata.label).toBe('large-x');
      expect(results[0]!.score).toBeCloseTo(1.0, 5);
      
      // Should still find similar direction
      expect(results[1]!.metadata.label).toBe('normal');
      expect(results[1]!.score).toBeCloseTo(1.0, 5);
    });

    it('should handle NaN and Infinity values', async () => {
      // Given: Vector with special values
      const validVector = [1, 0, 0];
      await store.store(validVector, { label: 'valid' });

      // When: Trying to store invalid vectors
      // Then: Should reject NaN
      await expect(store.store([NaN, 0, 0], {}))
        .rejects.toThrow('Vector contains invalid values (NaN)');

      // Should reject Infinity
      await expect(store.store([Infinity, 0, 0], {}))
        .rejects.toThrow('Vector contains invalid values (Infinity)');

      // Should reject -Infinity
      await expect(store.store([0, -Infinity, 0], {}))
        .rejects.toThrow('Vector contains invalid values (-Infinity)');
    });

    it('should handle empty search results gracefully', async () => {
      // Given: Single vector
      await store.store([1, 0, 0], { only: true });

      // When: Searching with impossible filter
      const results = await store.search([1, 0, 0], {
        k: 10,
        filter: { only: false }
      });

      // Then: Should return empty array (not null/undefined)
      expect(results).toEqual([]);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle k larger than dataset size', async () => {
      // Given: Small dataset
      await store.store([1, 0, 0], { id: 1 });
      await store.store([0, 1, 0], { id: 2 });
      await store.store([0, 0, 1], { id: 3 });

      // When: Requesting more results than available
      const results = await store.search([0.5, 0.5, 0], { k: 100 });

      // Then: Should return all available vectors
      expect(results).toHaveLength(3);
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
      expect(results[1]!.score).toBeGreaterThanOrEqual(results[2]!.score);
    });

    it('should handle concurrent modifications safely', async () => {
      // Given: Initial vectors
      const initialVectors = Array(100).fill(null).map((_, i) => ({
        vector: [Math.random(), Math.random(), Math.random()],
        metadata: { id: i }
      }));
      await store.storeBatch(initialVectors);

      // When: Concurrent operations
      const operations = [
        // Searches
        ...Array(10).fill(null).map(() => 
          store.search([Math.random(), Math.random(), Math.random()], { k: 5 })
        ),
        // Insertions
        ...Array(10).fill(null).map((_, i) => 
          store.store([Math.random(), Math.random(), Math.random()], { concurrent: i })
        ),
        // Deletions (mock)
        ...Array(5).fill(null).map(() => 
          store.delete(`vec_${Date.now()}_fake`)
        )
      ];

      // Then: All operations should complete without errors
      const results = await Promise.allSettled(operations);
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    });
  });

  describe('recovery and resilience', () => {
    it('should recover from corrupted index file', async () => {
      // Given: Store with persistent storage
      store = new VectorStore({ dimension: 3, path: testPath });
      await store.initialize();

      // Store some vectors
      const id1 = await store.store([1, 0, 0], { important: true });
      await store.close();

      // Corrupt the index file
      const indexFile = path.join(testPath, 'vectors.json');
      fs.writeFileSync(indexFile, '{ corrupted json invalid }}}');

      // When: Reinitializing store
      const newStore = new VectorStore({ dimension: 3, path: testPath });
      await newStore.initialize();

      // Then: Should handle corruption gracefully
      const result = await newStore.get(id1);
      expect(result).toBeNull(); // Data lost, but no crash

      // Should be able to add new vectors
      const newId = await newStore.store([0, 1, 0], { new: true });
      expect(newId).toBeDefined();

      await newStore.close();
    });

    it('should handle file system errors gracefully', async () => {
      // Given: Store with read-only path
      const readOnlyPath = '/root/no-permission'; // Typically no write permission
      store = new VectorStore({ 
        dimension: 3, 
        path: readOnlyPath,
        fallbackToMemory: true // Feature not implemented yet
      });

      // When: Initializing with permission error
      await store.initialize();

      // Then: Should fall back to in-memory mode
      const id = await store.store([1, 0, 0], {});
      expect(id).toBeDefined();

      const result = await store.get(id);
      expect(result).not.toBeNull();
    });

    it('should support backup and restore', async () => {
      // Given: Store with backup capability
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        enableBackup: true // Feature not implemented yet
      });
      await store.initialize();

      // Add data
      const vectors = [
        { vector: [1, 0, 0], metadata: { id: 1 } },
        { vector: [0, 1, 0], metadata: { id: 2 } },
        { vector: [0, 0, 1], metadata: { id: 3 } }
      ];
      await store.storeBatch(vectors);

      // When: Creating backup
      const backupPath = await store.createBackup();
      expect(backupPath).toBeDefined();

      // Clear store
      await store.clear();
      expect(await store.search([1, 0, 0], { k: 10 })).toHaveLength(0);

      // Then: Restore from backup
      await store.restoreFromBackup(backupPath);
      
      // Verify data restored
      const results = await store.search([1, 0, 0], { k: 10 });
      expect(results).toHaveLength(3);
      expect(results[0]!.metadata.id).toBe(1);
    });
  });

  describe('monitoring and diagnostics', () => {
    it('should provide performance metrics', async () => {
      // Given: Store with metrics enabled
      store = new VectorStore({ 
        dimension: 128,
        enableMetrics: true // Feature not implemented yet
      });
      await store.initialize();

      // Perform various operations
      for (let i = 0; i < 100; i++) {
        await store.store(Array(128).fill(0).map(() => Math.random()), { i });
      }

      for (let i = 0; i < 20; i++) {
        await store.search(Array(128).fill(0).map(() => Math.random()), { k: 5 });
      }

      // When: Getting metrics
      const metrics = await store.getMetrics();

      // Then: Should provide comprehensive metrics
      expect(metrics.operations.store.count).toBe(100);
      expect(metrics.operations.store.avgLatency).toBeGreaterThan(0);
      expect(metrics.operations.search.count).toBe(20);
      expect(metrics.operations.search.p95Latency).toBeDefined();
      expect(metrics.storage.vectorCount).toBe(100);
      expect(metrics.storage.indexSizeBytes).toBeGreaterThan(0);
    });

    it('should support health checks', async () => {
      // Given: Store with health monitoring
      store = new VectorStore({ 
        dimension: 3,
        healthCheckInterval: 1000 // Feature not implemented yet
      });
      await store.initialize();

      // When: Checking health
      const health = await store.checkHealth();

      // Then: Should report health status
      expect(health.status).toBe('healthy');
      expect(health.checks).toEqual({
        storage: 'ok',
        memory: 'ok',
        performance: 'ok'
      });
      expect(health.metrics).toBeDefined();
    });

    it('should detect and report anomalies', async () => {
      // Given: Store with anomaly detection
      store = new VectorStore({ 
        dimension: 3,
        detectAnomalies: true // Feature not implemented yet
      });
      await store.initialize();

      // Simulate anomaly: identical vectors being stored repeatedly
      const identicalVector = [0.5, 0.5, 0.5];
      for (let i = 0; i < 100; i++) {
        await store.store(identicalVector, { duplicate: i });
      }

      // When: Getting anomaly report
      const anomalies = await store.getAnomalies();

      // Then: Should detect unusual patterns
      expect(anomalies).toContainEqual({
        type: 'DUPLICATE_VECTORS',
        severity: 'warning',
        description: 'Large number of identical vectors detected',
        count: 100,
        recommendation: 'Consider deduplication or verify data source'
      });
    });
  });
});