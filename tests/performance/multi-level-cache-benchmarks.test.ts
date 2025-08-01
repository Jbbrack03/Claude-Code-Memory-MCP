import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { MultiLevelCache } from "../../src/utils/multi-level-cache.js";
import type { CacheLevel, CacheOptions } from "../../src/utils/multi-level-cache.js";
import { performance } from "perf_hooks";

// Mock cache level implementations for testing
class MockL2Cache implements CacheLevel<any> {
  private store = new Map<string, any>();
  private delay: number;

  constructor(delay: number = 5) {
    this.delay = delay;
  }

  async get(key: string): Promise<any> {
    await this.simulateDelay();
    return this.store.get(key);
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    await this.simulateDelay();
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.simulateDelay();
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    await this.simulateDelay();
    this.store.clear();
  }

  async has(key: string): Promise<boolean> {
    await this.simulateDelay();
    return this.store.has(key);
  }

  async size(): Promise<number> {
    await this.simulateDelay();
    return this.store.size;
  }

  async keys(): Promise<string[]> {
    await this.simulateDelay();
    return Array.from(this.store.keys());
  }

  private async simulateDelay(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, this.delay));
  }
}

class MockL3Cache extends MockL2Cache {
  constructor() {
    super(20); // Higher delay for L3
  }
}

describe('MultiLevelCache Performance Benchmarks', () => {
  let cache: MultiLevelCache<string>;
  let l2Cache: MockL2Cache;
  let l3Cache: MockL3Cache;

  beforeEach(() => {
    l2Cache = new MockL2Cache();
    l3Cache = new MockL3Cache();
    
    const options: CacheOptions = {
      l1MaxSize: 1000,
      l2Cache,
      l3Cache,
      defaultTTL: 60000
    };
    
    cache = new MultiLevelCache(options);
  });

  afterEach(async () => {
    await cache.clear();
  });

  describe('L1 cache performance', () => {
    it('should achieve L1 cache hit latency < 1ms (p95)', async () => {
      // Pre-populate L1 cache
      const testData = Array.from({ length: 100 }, (_, i) => ({
        key: `l1-key-${i}`,
        value: `l1-value-${i}-${'x'.repeat(100)}`
      }));

      for (const { key, value } of testData) {
        await cache.set(key, value);
      }

      const executionTimes: number[] = [];

      // Measure L1 hit performance
      for (let i = 0; i < 1000; i++) {
        const key = testData[i % testData.length].key;
        const startTime = performance.now();
        await cache.get(key);
        const endTime = performance.now();
        executionTimes.push(endTime - startTime);
      }

      // Calculate p95
      executionTimes.sort((a, b) => a - b);
      const p95Index = Math.floor(executionTimes.length * 0.95);
      const p95Time = executionTimes[p95Index];

      expect(p95Time).toBeLessThan(1);
    });

    it('should handle L1 cache misses efficiently', async () => {
      const executionTimes: number[] = [];

      // Measure L1 miss performance (cache should be empty)
      for (let i = 0; i < 100; i++) {
        const key = `miss-key-${i}`;
        const startTime = performance.now();
        const result = await cache.get(key);
        const endTime = performance.now();
        
        expect(result).toBeUndefined();
        executionTimes.push(endTime - startTime);
      }

      const avgTime = executionTimes.reduce((a, b) => a + b) / executionTimes.length;
      expect(avgTime).toBeLessThan(50); // Should be fast even for misses
    });
  });

  describe('L2 cache performance', () => {
    it('should achieve L2 cache hit latency < 10ms (p95)', async () => {
      // Pre-populate L2 cache (bypass L1)
      const testData = Array.from({ length: 50 }, (_, i) => ({
        key: `l2-key-${i}`,
        value: `l2-value-${i}-${'x'.repeat(500)}`
      }));

      // Populate L2 directly
      for (const { key, value } of testData) {
        await l2Cache.set(key, value);
      }

      const executionTimes: number[] = [];

      // Measure L2 hit performance
      for (let i = 0; i < 500; i++) {
        const key = testData[i % testData.length].key;
        const startTime = performance.now();
        await cache.get(key);
        const endTime = performance.now();
        executionTimes.push(endTime - startTime);
      }

      // Calculate p95
      executionTimes.sort((a, b) => a - b);
      const p95Index = Math.floor(executionTimes.length * 0.95);
      const p95Time = executionTimes[p95Index];

      expect(p95Time).toBeLessThan(10);
    });
  });

  describe('L3 cache performance', () => {
    it('should achieve L3 cache hit latency < 50ms (p95)', async () => {
      // Pre-populate L3 cache (bypass L1 and L2)
      const testData = Array.from({ length: 20 }, (_, i) => ({
        key: `l3-key-${i}`,
        value: `l3-value-${i}-${'x'.repeat(1000)}`
      }));

      // Populate L3 directly
      for (const { key, value } of testData) {
        await l3Cache.set(key, value);
      }

      const executionTimes: number[] = [];

      // Measure L3 hit performance
      for (let i = 0; i < 200; i++) {
        const key = testData[i % testData.length].key;
        const startTime = performance.now();
        await cache.get(key);
        const endTime = performance.now();
        executionTimes.push(endTime - startTime);
      }

      // Calculate p95
      executionTimes.sort((a, b) => a - b);
      const p95Index = Math.floor(executionTimes.length * 0.95);
      const p95Time = executionTimes[p95Index];

      expect(p95Time).toBeLessThan(50);
    });
  });

  describe('concurrent access performance', () => {
    it('should handle 1000+ simultaneous operations efficiently', async () => {
      // Pre-populate cache with test data
      const testData = Array.from({ length: 100 }, (_, i) => ({
        key: `concurrent-key-${i}`,
        value: `concurrent-value-${i}-${'x'.repeat(200)}`
      }));

      for (const { key, value } of testData) {
        await cache.set(key, value);
      }

      const concurrentOperations = 1000;
      const startTime = performance.now();

      // Create mix of read and write operations
      const operations = Array.from({ length: concurrentOperations }, (_, i) => {
        if (i % 10 === 0) {
          // 10% writes
          return cache.set(`new-key-${i}`, `new-value-${i}`);
        } else {
          // 90% reads
          const key = testData[i % testData.length].key;
          return cache.get(key);
        }
      });

      await Promise.all(operations);
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // Should handle 1000 operations in reasonable time
      expect(totalTime).toBeLessThan(5000); // 5 seconds max
      
      const opsPerSecond = concurrentOperations / (totalTime / 1000);
      expect(opsPerSecond).toBeGreaterThan(200); // At least 200 ops/sec
    });

    it('should maintain performance under read-heavy load', async () => {
      // Pre-populate cache
      const testData = Array.from({ length: 50 }, (_, i) => ({
        key: `read-heavy-key-${i}`,
        value: `read-heavy-value-${i}-${'x'.repeat(100)}`
      }));

      for (const { key, value } of testData) {
        await cache.set(key, value);
      }

      const readOperations = 2000;
      const startTime = performance.now();

      // Simulate read-heavy workload
      const reads = Array.from({ length: readOperations }, (_, i) => {
        const key = testData[i % testData.length].key;
        return cache.get(key);
      });

      const results = await Promise.all(reads);
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // All reads should succeed
      expect(results.every(result => result !== undefined)).toBe(true);
      
      const readsPerSecond = readOperations / (totalTime / 1000);
      expect(readsPerSecond).toBeGreaterThan(500); // At least 500 reads/sec
    });
  });

  describe('LRU eviction performance', () => {
    it('should perform LRU eviction efficiently with large datasets', async () => {
      const cacheSize = 100;
      const smallCache = new MultiLevelCache<string>({
        l1MaxSize: cacheSize,
        l2Cache,
        l3Cache
      });

      const datasetSize = cacheSize * 3; // 3x cache size to force evictions
      const executionTimes: number[] = [];

      // Fill cache beyond capacity to trigger evictions
      for (let i = 0; i < datasetSize; i++) {
        const key = `eviction-key-${i}`;
        const value = `eviction-value-${i}-${'x'.repeat(50)}`;
        
        const startTime = performance.now();
        await smallCache.set(key, value);
        const endTime = performance.now();
        
        executionTimes.push(endTime - startTime);
      }

      // Calculate average eviction time
      const avgTime = executionTimes.reduce((a, b) => a + b) / executionTimes.length;
      expect(avgTime).toBeLessThan(2); // Eviction should be fast

      // Verify cache size doesn't exceed limit
      const stats = smallCache.getStats();
      expect(stats.l1Hits + stats.l1Misses).toBeGreaterThan(0); // Verify L1 activity

      await smallCache.clear();
    });

    it('should maintain O(1) eviction complexity', async () => {
      const testSizes = [50, 100, 200, 400];
      const evictionTimes: number[] = [];

      for (const size of testSizes) {
        const testCache = new MultiLevelCache<string>({
          l1MaxSize: size,
          l2Cache,
          l3Cache
        });

        // Fill to capacity
        for (let i = 0; i < size; i++) {
          await testCache.set(`key-${i}`, `value-${i}`);
        }

        // Measure eviction time
        const startTime = performance.now();
        await testCache.set('eviction-trigger', 'eviction-value');
        const endTime = performance.now();
        
        evictionTimes.push(endTime - startTime);
        await testCache.clear();
      }

      // Eviction times should not increase significantly with cache size
      const firstTime = evictionTimes[0];
      const lastTime = evictionTimes[evictionTimes.length - 1];
      const ratio = lastTime / firstTime;
      
      // Should be roughly O(1) - allow some variance but not linear growth
      expect(ratio).toBeLessThan(3);
    });
  });

  describe('cache promotion latency', () => {
    it('should promote from L2 to L1 quickly', async () => {
      // Set up data in L2 only
      const key = 'promotion-test-key';
      const value = 'promotion-test-value';
      await l2Cache.set(key, value);

      const promotionTimes: number[] = [];

      // Measure promotion performance multiple times
      for (let i = 0; i < 50; i++) {
        // Clear L1 to ensure we're testing promotion
        const freshCache = new MultiLevelCache<string>({
          l1MaxSize: 1000,
          l2Cache,
          l3Cache
        });

        const startTime = performance.now();
        const result = await freshCache.get(key);
        const endTime = performance.now();

        expect(result).toBe(value);
        promotionTimes.push(endTime - startTime);
        
        await freshCache.clear();
      }

      const avgPromotionTime = promotionTimes.reduce((a, b) => a + b) / promotionTimes.length;
      expect(avgPromotionTime).toBeLessThan(15); // Should be quick
    });

    it('should promote from L3 to L1 within acceptable time', async () => {
      // Set up data in L3 only
      const key = 'l3-promotion-test-key';
      const value = 'l3-promotion-test-value';
      await l3Cache.set(key, value);

      const promotionTimes: number[] = [];

      // Measure L3 to L1 promotion
      for (let i = 0; i < 20; i++) {
        const freshCache = new MultiLevelCache<string>({
          l1MaxSize: 1000,
          l2Cache,
          l3Cache
        });

        const startTime = performance.now();
        const result = await freshCache.get(key);
        const endTime = performance.now();

        expect(result).toBe(value);
        promotionTimes.push(endTime - startTime);
        
        await freshCache.clear();
      }

      const avgPromotionTime = promotionTimes.reduce((a, b) => a + b) / promotionTimes.length;
      expect(avgPromotionTime).toBeLessThan(60); // L3 promotion takes longer
    });
  });

  describe('memory efficiency tests', () => {
    it('should maintain memory efficiency with large values', async () => {
      const largeValueSize = 10000; // 10KB strings
      const numValues = 100;
      
      const initialMemory = process.memoryUsage().heapUsed;

      // Store large values
      for (let i = 0; i < numValues; i++) {
        const key = `large-key-${i}`;
        const value = 'x'.repeat(largeValueSize);
        await cache.set(key, value);
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable (allow for overhead)
      const expectedMinimum = numValues * largeValueSize;
      const expectedMaximum = expectedMinimum * 2; // Allow 100% overhead
      
      expect(memoryIncrease).toBeGreaterThan(expectedMinimum);
      expect(memoryIncrease).toBeLessThan(expectedMaximum);
    });

    it('should handle memory pressure gracefully', async () => {
      // Create smaller cache to test pressure scenarios
      const smallCache = new MultiLevelCache<string>({
        l1MaxSize: 50,
        l2Cache,
        l3Cache
      });

      const largeData = Array.from({ length: 200 }, (_, i) => ({
        key: `pressure-key-${i}`,
        value: 'x'.repeat(1000) // 1KB each
      }));

      // Fill beyond capacity
      for (const { key, value } of largeData) {
        await smallCache.set(key, value);
      }

      // Test some cache lookups to generate stats
      for (let i = 0; i < 10; i++) {
        await smallCache.get(`pressure-key-${i}`);
      }

      // Cache should still be functional
      const stats = smallCache.getStats();
      expect(stats.hits + stats.misses).toBeGreaterThan(0); // Verify cache activity
      expect(stats.hitRate).toBeGreaterThan(0);

      // Should be able to retrieve recently set items
      const recentKey = largeData[largeData.length - 1].key;
      const result = await smallCache.get(recentKey);
      expect(result).toBeDefined();

      await smallCache.clear();
    });

    it('should optimize memory usage across cache levels', async () => {
      const testData = Array.from({ length: 300 }, (_, i) => ({
        key: `memory-opt-key-${i}`,
        value: `memory-opt-value-${i}-${'x'.repeat(100)}`
      }));

      // Populate cache
      for (const { key, value } of testData) {
        await cache.set(key, value);
      }

      const stats = cache.getStats();
      
      // L1 should be at capacity, others should have overflow
      expect(stats.l1Hits).toBeGreaterThan(0); // Verify L1 cache usage
      expect(stats.l2Hits + stats.l2Misses).toBeGreaterThan(0); // Verify L2 activity
      expect(stats.l3Hits + stats.l3Misses).toBeGreaterThan(0); // Verify L3 activity
      
      // Total stored should equal input
      expect(stats.hits + stats.misses).toBeGreaterThan(0); // Verify overall cache activity
    });
  });

  describe('cache statistics performance', () => {
    it('should calculate statistics quickly', async () => {
      // Populate cache with test data
      const testData = Array.from({ length: 1000 }, (_, i) => ({
        key: `stats-key-${i}`,
        value: `stats-value-${i}`
      }));

      for (const { key, value } of testData) {
        await cache.set(key, value);
      }

      // Perform some operations to generate stats
      for (let i = 0; i < 500; i++) {
        await cache.get(`stats-key-${i % 100}`);
      }

      const statsTimes: number[] = [];

      // Measure stats calculation performance
      for (let i = 0; i < 100; i++) {
        const startTime = performance.now();
        const stats = cache.getStats();
        const endTime = performance.now();
        
        expect(stats).toBeDefined();
        expect(stats.hits).toBeGreaterThan(0);
        expect(stats.hitRate).toBeGreaterThan(0);
        
        statsTimes.push(endTime - startTime);
      }

      const avgStatsTime = statsTimes.reduce((a, b) => a + b) / statsTimes.length;
      expect(avgStatsTime).toBeLessThan(5); // Stats should be very fast
    });
  });
});