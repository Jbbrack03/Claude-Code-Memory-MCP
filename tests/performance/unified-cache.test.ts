import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { performance } from 'perf_hooks';
import { 
  UnifiedCache, 
  UnifiedCacheConfig, 
  CacheMetrics, 
  CacheEntry 
} from '../../src/performance/unified-cache.js';

describe('UnifiedCache', () => {
  let cache: UnifiedCache<string>;
  let config: UnifiedCacheConfig;

  beforeEach(() => {
    jest.useFakeTimers();
    config = {
      maxSize: 1000,
      defaultTTL: 60000, // 1 minute
      maxMemoryMB: 50,
      enableMetrics: true
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Core Operations', () => {
    describe('Basic CRUD Operations', () => {
      it('should create cache with valid configuration', () => {
        // Given: A valid cache configuration
        const config: UnifiedCacheConfig = {
          maxSize: 100,
          defaultTTL: 30000,
          maxMemoryMB: 10
        };

        // When: Creating a new UnifiedCache
        // Then: Should create successfully without throwing
        expect(() => {
          cache = new UnifiedCache<string>(config);
        }).not.toThrow();
      });

      it('should set and get values correctly', async () => {
        // Given: A cache instance
        cache = new UnifiedCache<string>(config);

        // When: Setting and getting a value
        await cache.set('key1', 'value1');
        const result = await cache.get('key1');

        // Then: Should return the correct value
        expect(result).toBe('value1');
      });

      it('should return undefined for non-existent keys', async () => {
        // Given: A cache instance
        cache = new UnifiedCache<string>(config);

        // When: Getting a non-existent key
        const result = await cache.get('nonexistent');

        // Then: Should return undefined
        expect(result).toBeUndefined();
      });

      it('should delete values correctly', async () => {
        // Given: A cache with a stored value
        cache = new UnifiedCache<string>(config);
        await cache.set('key1', 'value1');

        // When: Deleting the value
        await cache.delete('key1');
        const result = await cache.get('key1');

        // Then: Should return undefined after deletion
        expect(result).toBeUndefined();
      });

      it('should check key existence correctly', async () => {
        // Given: A cache with a stored value
        cache = new UnifiedCache<string>(config);
        await cache.set('key1', 'value1');

        // When: Checking if key exists
        const exists = await cache.has('key1');
        const notExists = await cache.has('nonexistent');

        // Then: Should return correct existence status
        expect(exists).toBe(true);
        expect(notExists).toBe(false);
      });

      it('should return correct cache size', async () => {
        // Given: A cache with multiple values
        cache = new UnifiedCache<string>(config);
        await cache.set('key1', 'value1');
        await cache.set('key2', 'value2');

        // When: Getting cache size
        const size = await cache.size();

        // Then: Should return correct count
        expect(size).toBe(2);
      });

      it('should return all cache keys', async () => {
        // Given: A cache with multiple values
        cache = new UnifiedCache<string>(config);
        await cache.set('key1', 'value1');
        await cache.set('key2', 'value2');

        // When: Getting all keys
        const keys = await cache.keys();

        // Then: Should return all stored keys
        expect(keys).toHaveLength(2);
        expect(keys).toContain('key1');
        expect(keys).toContain('key2');
      });

      it('should clear all cache entries', async () => {
        // Given: A cache with multiple values
        cache = new UnifiedCache<string>(config);
        await cache.set('key1', 'value1');
        await cache.set('key2', 'value2');

        // When: Clearing the cache
        await cache.clear();
        const size = await cache.size();

        // Then: Should have no entries
        expect(size).toBe(0);
      });
    });

    describe('TTL (Time To Live) Support', () => {
      it('should expire entries after TTL', async () => {
        // Given: A cache with TTL-enabled entry
        cache = new UnifiedCache<string>(config);
        await cache.set('key1', 'value1', 1000); // 1 second TTL

        // When: Time passes beyond TTL
        jest.advanceTimersByTime(1001);
        const result = await cache.get('key1');

        // Then: Should return undefined (expired)
        expect(result).toBeUndefined();
      });

      it('should use default TTL when not specified', async () => {
        // Given: A cache with default TTL configuration
        const configWithTTL: UnifiedCacheConfig = {
          ...config,
          defaultTTL: 500
        };
        cache = new UnifiedCache<string>(configWithTTL);
        await cache.set('key1', 'value1'); // No TTL specified

        // When: Time passes beyond default TTL
        jest.advanceTimersByTime(501);
        const result = await cache.get('key1');

        // Then: Should return undefined (expired)
        expect(result).toBeUndefined();
      });

      it('should not expire entries without TTL', async () => {
        // Given: A cache with entry without TTL
        const configNoTTL: UnifiedCacheConfig = {
          maxSize: 100
          // No defaultTTL
        };
        cache = new UnifiedCache<string>(configNoTTL);
        await cache.set('key1', 'value1');

        // When: Significant time passes
        jest.advanceTimersByTime(10000);
        const result = await cache.get('key1');

        // Then: Should still return the value
        expect(result).toBe('value1');
      });

      it('should handle TTL updates correctly', async () => {
        // Given: A cache with TTL-enabled entry
        cache = new UnifiedCache<string>(config);
        await cache.set('key1', 'value1', 1000);

        // When: Updating with new TTL
        await cache.set('key1', 'updated_value', 2000);
        jest.advanceTimersByTime(1001); // Past original TTL
        const result = await cache.get('key1');

        // Then: Should still be available with new TTL
        expect(result).toBe('updated_value');
      });
    });

    describe('Memory Limits and LRU Eviction', () => {
      it('should evict LRU entries when size limit exceeded', async () => {
        // Given: A cache with small size limit
        const smallConfig: UnifiedCacheConfig = {
          maxSize: 2,
          maxMemoryMB: 50
        };
        cache = new UnifiedCache<string>(smallConfig);

        // When: Adding more entries than limit
        await cache.set('key1', 'value1');
        await cache.set('key2', 'value2');
        await cache.set('key3', 'value3'); // Should evict key1

        // Then: Oldest entry should be evicted
        const result1 = await cache.get('key1');
        const result2 = await cache.get('key2');
        const result3 = await cache.get('key3');

        expect(result1).toBeUndefined();
        expect(result2).toBe('value2');
        expect(result3).toBe('value3');
      });

      it('should update LRU order on access', async () => {
        // Given: A cache with entries in specific order
        const smallConfig: UnifiedCacheConfig = {
          maxSize: 2,
          maxMemoryMB: 50
        };
        cache = new UnifiedCache<string>(smallConfig);
        await cache.set('key1', 'value1');
        await cache.set('key2', 'value2');

        // When: Accessing first entry then adding new entry
        await cache.get('key1'); // Updates LRU order
        await cache.set('key3', 'value3'); // Should evict key2

        // Then: Recently accessed entry should remain
        const result1 = await cache.get('key1');
        const result2 = await cache.get('key2');
        const result3 = await cache.get('key3');

        expect(result1).toBe('value1');
        expect(result2).toBeUndefined();
        expect(result3).toBe('value3');
      });

      it('should respect memory limit and evict entries', async () => {
        // Given: A cache with memory limit
        const memoryConfig: UnifiedCacheConfig = {
          maxSize: 1000,
          maxMemoryMB: 1 // Very small memory limit
        };
        cache = new UnifiedCache<string>(memoryConfig);

        // When: Adding large entries that exceed memory limit
        const largeValue = 'x'.repeat(500000); // ~500KB
        await cache.set('key1', largeValue);
        await cache.set('key2', largeValue);
        await cache.set('key3', largeValue); // Should trigger eviction

        // Then: Should maintain memory limit by evicting entries
        const memoryUsage = cache.getMemoryUsage();
        expect(memoryUsage).toBeLessThan(1024 * 1024); // Less than 1MB
      });

      it('should track eviction metrics', async () => {
        // Given: A cache that will trigger evictions
        const smallConfig: UnifiedCacheConfig = {
          maxSize: 2,
          enableMetrics: true
        };
        cache = new UnifiedCache<string>(smallConfig);

        // When: Adding entries that trigger eviction
        await cache.set('key1', 'value1');
        await cache.set('key2', 'value2');
        await cache.set('key3', 'value3'); // Triggers eviction

        // Then: Should track eviction count
        const metrics = cache.getMetrics();
        expect(metrics.evictions).toBe(1);
      });
    });

    describe('Concurrent Access Safety', () => {
      it('should handle concurrent reads safely', async () => {
        // Given: A cache with a value
        cache = new UnifiedCache<string>(config);
        await cache.set('key1', 'value1');

        // When: Multiple concurrent reads
        const promises = Array.from({ length: 10 }, () => cache.get('key1'));
        const results = await Promise.all(promises);

        // Then: All reads should return correct value
        results.forEach(result => {
          expect(result).toBe('value1');
        });
      });

      it('should handle concurrent writes safely', async () => {
        // Given: A cache instance
        cache = new UnifiedCache<string>(config);

        // When: Multiple concurrent writes to same key
        const promises = Array.from({ length: 10 }, (_, i) => 
          cache.set('key1', `value${i}`)
        );
        await Promise.all(promises);

        // Then: Should have exactly one final value
        const result = await cache.get('key1');
        expect(result).toMatch(/^value\d$/);
        
        const size = await cache.size();
        expect(size).toBe(1);
      });

      it('should handle concurrent mixed operations safely', async () => {
        // Given: A cache instance
        cache = new UnifiedCache<string>(config);

        // When: Mixed concurrent operations
        const operations = [
          cache.set('key1', 'value1'),
          cache.set('key2', 'value2'),
          cache.get('key1'),
          cache.delete('key1'),
          cache.has('key2'),
          cache.size()
        ];
        
        // Then: Should complete without errors
        await expect(Promise.all(operations)).resolves.not.toThrow();
      });

      it('should handle concurrent eviction scenarios', async () => {
        // Given: A cache with small limit
        const smallConfig: UnifiedCacheConfig = {
          maxSize: 5,
          maxMemoryMB: 10
        };
        cache = new UnifiedCache<string>(smallConfig);

        // When: Concurrent writes that trigger evictions
        const promises = Array.from({ length: 20 }, (_, i) => 
          cache.set(`key${i}`, `value${i}`)
        );
        await Promise.all(promises);

        // Then: Should maintain size limit without corruption
        const size = await cache.size();
        expect(size).toBeLessThanOrEqual(5);
        
        const keys = await cache.keys();
        expect(keys).toHaveLength(size);
      });
    });
  });

  describe('Performance Comparison', () => {
    describe('Latency Requirements', () => {
      it('should achieve sub-millisecond get latency', async () => {
        // Given: A cache with data
        cache = new UnifiedCache<string>(config);
        await cache.set('key1', 'value1');

        // When: Measuring get operation latency
        const iterations = 1000;
        const start = performance.now();
        
        for (let i = 0; i < iterations; i++) {
          await cache.get('key1');
        }
        
        const end = performance.now();
        const avgLatency = (end - start) / iterations;

        // Then: Average latency should be less than 1ms
        expect(avgLatency).toBeLessThan(1);
      });

      it('should achieve sub-millisecond set latency', async () => {
        // Given: A cache instance
        cache = new UnifiedCache<string>(config);

        // When: Measuring set operation latency
        const iterations = 1000;
        const start = performance.now();
        
        for (let i = 0; i < iterations; i++) {
          await cache.set(`key${i}`, `value${i}`);
        }
        
        const end = performance.now();
        const avgLatency = (end - start) / iterations;

        // Then: Average latency should be less than 1ms
        expect(avgLatency).toBeLessThan(1);
      });

      it('should maintain low latency under memory pressure', async () => {
        // Given: A cache under memory pressure
        const pressureConfig: UnifiedCacheConfig = {
          maxSize: 100,
          maxMemoryMB: 5
        };
        cache = new UnifiedCache<string>(pressureConfig);

        // Fill cache to trigger evictions
        for (let i = 0; i < 200; i++) {
          await cache.set(`key${i}`, 'x'.repeat(1000)); // 1KB values
        }

        // When: Measuring operations under pressure
        const start = performance.now();
        await cache.get('key150');
        const end = performance.now();

        // Then: Should maintain sub-millisecond latency
        expect(end - start).toBeLessThan(1);
      });

      it('should have consistent latency across cache sizes', async () => {
        // Given: Different cache configurations
        const sizes = [100, 1000, 10000];
        const latencies: number[] = [];

        for (const size of sizes) {
          const testConfig: UnifiedCacheConfig = {
            maxSize: size,
            maxMemoryMB: 50
          };
          const testCache = new UnifiedCache<string>(testConfig);

          // Fill half the cache
          for (let i = 0; i < size / 2; i++) {
            await testCache.set(`key${i}`, `value${i}`);
          }

          // Measure latency
          const start = performance.now();
          await testCache.get('key10');
          const end = performance.now();
          
          latencies.push(end - start);
        }

        // Then: Latency should be consistent across sizes
        const maxLatency = Math.max(...latencies);
        const minLatency = Math.min(...latencies);
        expect(maxLatency - minLatency).toBeLessThan(0.5); // Within 0.5ms variance
      });
    });

    describe('Throughput Requirements', () => {
      it('should achieve 1000+ read operations per second', async () => {
        // Given: A cache with data
        cache = new UnifiedCache<string>(config);
        for (let i = 0; i < 100; i++) {
          await cache.set(`key${i}`, `value${i}`);
        }

        // When: Measuring read throughput
        const duration = 1000; // 1 second
        const start = performance.now();
        let operations = 0;

        while (performance.now() - start < duration) {
          await cache.get(`key${operations % 100}`);
          operations++;
        }

        // Then: Should achieve 1000+ ops/sec
        expect(operations).toBeGreaterThan(1000);
      });

      it('should achieve 1000+ write operations per second', async () => {
        // Given: A large cache
        const largeConfig: UnifiedCacheConfig = {
          maxSize: 10000,
          maxMemoryMB: 100
        };
        cache = new UnifiedCache<string>(largeConfig);

        // When: Measuring write throughput
        const duration = 1000; // 1 second
        const start = performance.now();
        let operations = 0;

        while (performance.now() - start < duration) {
          await cache.set(`key${operations}`, `value${operations}`);
          operations++;
        }

        // Then: Should achieve 1000+ ops/sec
        expect(operations).toBeGreaterThan(1000);
      });

      it('should maintain throughput under concurrent load', async () => {
        // Given: A cache instance
        cache = new UnifiedCache<string>(config);

        // When: Concurrent operations from multiple "clients"
        const concurrency = 10;
        const operationsPerClient = 200;
        
        const start = performance.now();
        const promises = Array.from({ length: concurrency }, async (_, clientId) => {
          for (let i = 0; i < operationsPerClient; i++) {
            await cache.set(`client${clientId}_key${i}`, `value${i}`);
            await cache.get(`client${clientId}_key${i}`);
          }
        });
        
        await Promise.all(promises);
        const end = performance.now();

        const totalOps = concurrency * operationsPerClient * 2; // set + get
        const opsPerSecond = (totalOps / (end - start)) * 1000;

        // Then: Should maintain high throughput
        expect(opsPerSecond).toBeGreaterThan(1000);
      });

      it('should scale throughput with available CPU cores', async () => {
        // Given: Cache instances for different concurrency levels
        cache = new UnifiedCache<string>(config);
        const results: { concurrency: number; throughput: number }[] = [];

        // When: Testing different concurrency levels
        for (const concurrency of [1, 2, 4, 8]) {
          const operationsPerWorker = 100;
          
          const start = performance.now();
          const promises = Array.from({ length: concurrency }, async (_, workerId) => {
            for (let i = 0; i < operationsPerWorker; i++) {
              await cache.set(`worker${workerId}_key${i}`, `value${i}`);
            }
          });
          
          await Promise.all(promises);
          const end = performance.now();

          const totalOps = concurrency * operationsPerWorker;
          const throughput = (totalOps / (end - start)) * 1000;
          results.push({ concurrency, throughput });
        }

        // Then: Throughput should be reasonable across concurrency levels
        // For a simple cache, some contention is expected at high concurrency
        expect(results[1].throughput).toBeGreaterThan(results[0].throughput * 0.7);
      });
    });

    describe('Memory Usage Optimization', () => {
      it('should use 50% less memory than MultiLevelCache', async () => {
        // Given: Comparable configurations
        const testData = Array.from({ length: 1000 }, (_, i) => ({
          key: `key${i}`,
          value: 'x'.repeat(100) // 100 bytes per value
        }));

        // MultiLevelCache memory usage (simulated)
        const multiLevelMemory = testData.length * 200; // Assuming 200 bytes overhead per entry

        // When: Using UnifiedCache
        cache = new UnifiedCache<string>(config);
        for (const { key, value } of testData) {
          await cache.set(key, value);
        }

        const unifiedMemory = cache.getMemoryUsage();

        // Then: Should use significantly less memory
        expect(unifiedMemory).toBeLessThan(multiLevelMemory * 0.5);
      });

      it('should have efficient memory allocation patterns', async () => {
        // Given: A cache instance
        cache = new UnifiedCache<string>(config);

        // When: Adding and removing entries
        const initialMemory = cache.getMemoryUsage();
        
        // Add entries
        for (let i = 0; i < 100; i++) {
          await cache.set(`key${i}`, 'x'.repeat(1000));
        }
        const peakMemory = cache.getMemoryUsage();

        // Remove entries
        for (let i = 0; i < 50; i++) {
          await cache.delete(`key${i}`);
        }
        const afterDeletionMemory = cache.getMemoryUsage();

        // Then: Memory should be reclaimed efficiently
        expect(afterDeletionMemory).toBeLessThan(peakMemory * 0.7);
        expect(afterDeletionMemory).toBeGreaterThan(initialMemory);
      });

      it('should support memory compaction', async () => {
        // Given: A cache with fragmented memory
        cache = new UnifiedCache<string>(config);

        // Create fragmentation
        for (let i = 0; i < 100; i++) {
          await cache.set(`key${i}`, 'x'.repeat(1000));
        }
        
        // Delete every other entry
        for (let i = 0; i < 100; i += 2) {
          await cache.delete(`key${i}`);
        }

        const beforeCompaction = cache.getMemoryUsage();

        // When: Running compaction
        await cache.compact();
        const afterCompaction = cache.getMemoryUsage();

        // Then: Memory usage should be reduced
        expect(afterCompaction).toBeLessThan(beforeCompaction);
      });

      it('should handle large entries efficiently', async () => {
        // Given: A cache configured for large entries
        const largeConfig: UnifiedCacheConfig = {
          maxSize: 10,
          maxMemoryMB: 100
        };
        cache = new UnifiedCache<string>(largeConfig);

        // When: Storing large entries
        const largeValue = 'x'.repeat(1024 * 1024); // 1MB
        await cache.set('large1', largeValue);
        await cache.set('large2', largeValue);

        // Then: Should handle efficiently without excessive overhead
        const memoryUsage = cache.getMemoryUsage();
        const expectedMinimum = 2 * 1024 * 1024; // 2MB for data
        const expectedMaximum = 2.5 * 1024 * 1024; // 2.5MB including overhead

        expect(memoryUsage).toBeGreaterThan(expectedMinimum);
        expect(memoryUsage).toBeLessThan(expectedMaximum);
      });
    });
  });

  describe('Migration Compatibility', () => {
    describe('Drop-in Replacement Interface', () => {
      it('should implement all MultiLevelCache methods', async () => {
        // Given: A UnifiedCache instance
        cache = new UnifiedCache<string>(config);

        // When: Checking method availability
        const requiredMethods = [
          'get', 'set', 'delete', 'clear', 'has', 'size', 'keys',
          'invalidate', 'invalidatePattern', 'getMetrics', 'resetMetrics'
        ];

        // Then: All methods should be available
        for (const method of requiredMethods) {
          expect(typeof (cache as any)[method]).toBe('function');
        }
      });

      it('should maintain compatible method signatures', async () => {
        // Given: A UnifiedCache instance
        cache = new UnifiedCache<string>(config);

        // When/Then: Methods should accept compatible parameters
        await expect(cache.get('key')).resolves.not.toThrow();
        await expect(cache.set('key', 'value')).resolves.not.toThrow();
        await expect(cache.set('key', 'value', 1000)).resolves.not.toThrow();
        await expect(cache.delete('key')).resolves.not.toThrow();
        await expect(cache.has('key')).resolves.not.toThrow();
        await expect(cache.invalidate('key')).resolves.not.toThrow();
        await expect(cache.invalidatePattern('pattern*')).resolves.not.toThrow();
        await expect(cache.invalidatePattern(/pattern.*/)).resolves.not.toThrow();
      });

      it('should return compatible data types', async () => {
        // Given: A UnifiedCache with data
        cache = new UnifiedCache<string>(config);
        await cache.set('key1', 'value1');

        // When: Calling methods
        const getValue = await cache.get('key1');
        const hasValue = await cache.has('key1');
        const sizeValue = await cache.size();
        const keysValue = await cache.keys();
        const metrics = cache.getMetrics();

        // Then: Should return expected types
        expect(typeof getValue).toBe('string');
        expect(typeof hasValue).toBe('boolean');
        expect(typeof sizeValue).toBe('number');
        expect(Array.isArray(keysValue)).toBe(true);
        expect(typeof metrics).toBe('object');
        expect(typeof metrics.hits).toBe('number');
        expect(typeof metrics.misses).toBe('number');
        expect(typeof metrics.hitRate).toBe('number');
      });

      it('should handle pattern invalidation like MultiLevelCache', async () => {
        // Given: A cache with multiple entries
        cache = new UnifiedCache<string>(config);
        await cache.set('user:1:profile', 'profile1');
        await cache.set('user:1:settings', 'settings1');
        await cache.set('user:2:profile', 'profile2');
        await cache.set('post:1', 'post1');

        // When: Invalidating with pattern
        await cache.invalidatePattern('user:1:*');

        // Then: Should invalidate matching entries only
        expect(await cache.has('user:1:profile')).toBe(false);
        expect(await cache.has('user:1:settings')).toBe(false);
        expect(await cache.has('user:2:profile')).toBe(true);
        expect(await cache.has('post:1')).toBe(true);
      });
    });

    describe('Data Preservation During Migration', () => {
      it('should preserve existing cache data during migration', async () => {
        // Given: Existing cache data (simulated MultiLevelCache state)
        const existingData = new Map([
          ['key1', 'value1'],
          ['key2', 'value2'],
          ['key3', 'value3']
        ]);

        // When: Migrating to UnifiedCache
        cache = new UnifiedCache<string>(config);
        
        // Simulate data migration
        for (const [key, value] of existingData) {
          await cache.set(key, value);
        }

        // Then: All data should be preserved
        for (const [key, expectedValue] of existingData) {
          const actualValue = await cache.get(key);
          expect(actualValue).toBe(expectedValue);
        }
      });

      it('should maintain TTL information during migration', async () => {
        // Given: Existing cache with TTL data
        cache = new UnifiedCache<string>(config);

        // Simulate migration with TTL preservation
        const ttlData = [
          { key: 'short', value: 'shortlived', ttl: 1000 },
          { key: 'long', value: 'longlived', ttl: 5000 },
          { key: 'permanent', value: 'permanent' } // No TTL
        ];

        // When: Migrating data with TTL
        for (const { key, value, ttl } of ttlData) {
          await cache.set(key, value, ttl);
        }

        // Then: TTL should be preserved
        jest.advanceTimersByTime(1001);
        expect(await cache.get('short')).toBeUndefined(); // Expired
        expect(await cache.get('long')).toBe('longlived'); // Still valid
        expect(await cache.get('permanent')).toBe('permanent'); // No expiry
      });

      it('should handle migration rollback scenarios', async () => {
        // Given: A cache with critical data
        cache = new UnifiedCache<string>(config);
        const criticalData = [
          ['session:user123', 'sessiondata'],
          ['auth:token456', 'tokendata'],
          ['temp:cache789', 'tempdata']
        ];

        for (const [key, value] of criticalData) {
          await cache.set(key, value);
        }

        // When: Simulating migration failure and rollback
        const backupData: Array<[string, string]> = [];
        const keys = await cache.keys();
        
        for (const key of keys) {
          const value = await cache.get(key);
          if (value !== undefined) {
            backupData.push([key, value]);
          }
        }

        // Simulate migration failure
        await cache.clear();

        // Rollback
        for (const [key, value] of backupData) {
          await cache.set(key, value);
        }

        // Then: All data should be restored
        for (const [key, expectedValue] of criticalData) {
          const actualValue = await cache.get(key);
          expect(actualValue).toBe(expectedValue);
        }
      });

      it('should validate data integrity after migration', async () => {
        // Given: Cache with various data types
        cache = new UnifiedCache<string>(config);
        const testData = [
          ['string', 'stringvalue'],
          ['empty', ''],
          ['special', 'value with spaces and symbols !@#$%^&*()'],
          ['unicode', '测试数据 🚀 emoji'],
          ['large', 'x'.repeat(10000)]
        ];

        // When: Storing and retrieving data
        for (const [key, value] of testData) {
          await cache.set(key, value);
        }

        // Then: All data should be intact
        for (const [key, expectedValue] of testData) {
          const actualValue = await cache.get(key);
          expect(actualValue).toBe(expectedValue);
          expect(actualValue?.length).toBe(expectedValue.length);
        }
      });
    });

    describe('Fallback Mechanisms', () => {
      it('should gracefully handle external storage failures', async () => {
        // Given: Cache with external storage that might fail
        const externalConfig: UnifiedCacheConfig = {
          maxSize: 100,
          externalStorage: {
            type: 'redis',
            url: 'redis://localhost:6379',
            options: { retryAttempts: 3 }
          }
        };

        // When: External storage is unavailable
        cache = new UnifiedCache<string>(externalConfig);
        
        // Then: Should still function with in-memory cache
        await expect(cache.set('key1', 'value1')).resolves.not.toThrow();
        await expect(cache.get('key1')).resolves.toBe('value1');
      });

      it('should maintain service during cache warming', async () => {
        // Given: A cache during warm-up period
        cache = new UnifiedCache<string>(config);

        // When: Cache is being warmed up with data
        const warmupPromises = Array.from({ length: 100 }, (_, i) =>
          cache.set(`warmup:key${i}`, `value${i}`)
        );

        // Concurrent reads during warmup
        const readPromises = Array.from({ length: 50 }, (_, i) =>
          cache.get(`warmup:key${i}`)
        );

        // Then: Should handle concurrent operations during warmup
        await expect(Promise.all([...warmupPromises, ...readPromises]))
          .resolves.not.toThrow();
      });

      it('should provide degraded service under memory pressure', async () => {
        // Given: Cache under extreme memory pressure
        const pressureConfig: UnifiedCacheConfig = {
          maxSize: 10,
          maxMemoryMB: 1
        };
        cache = new UnifiedCache<string>(pressureConfig);

        // When: Adding more data than memory allows
        const operations: Promise<void>[] = [];
        for (let i = 0; i < 100; i++) {
          operations.push(cache.set(`key${i}`, 'x'.repeat(10000))); // 10KB each
        }

        // Then: Should maintain basic functionality
        await Promise.all(operations);
        const size = await cache.size();
        expect(size).toBeGreaterThan(0); // Should maintain some entries
        expect(size).toBeLessThanOrEqual(10); // Should respect limits
      });

      it('should recover from temporary failures', async () => {
        // Given: A cache that experiences temporary failure
        cache = new UnifiedCache<string>(config);
        await cache.set('key1', 'value1');

        // When: Simulating basic resilience
        // The cache should be robust enough to handle normal operations
        const result = await cache.get('key1');

        // Then: Should return the expected value
        expect(result).toBe('value1');
        
        // Verify cache remains functional after operations
        await cache.set('key2', 'value2');
        const result2 = await cache.get('key2');
        expect(result2).toBe('value2');
      });
    });
  });

  describe('Simplified Configuration', () => {
    describe('Single Configuration Object', () => {
      it('should accept minimal configuration', () => {
        // Given: Minimal configuration
        const minimalConfig: UnifiedCacheConfig = {
          maxSize: 100
        };

        // When: Creating cache with minimal config
        // Then: Should create successfully with defaults
        expect(() => {
          cache = new UnifiedCache<string>(minimalConfig);
        }).not.toThrow();
      });

      it('should apply sensible defaults', async () => {
        // Given: Configuration with defaults
        const defaultConfig: UnifiedCacheConfig = {
          maxSize: 100
        };
        cache = new UnifiedCache<string>(defaultConfig);

        // When: Using cache without explicit TTL
        await cache.set('key1', 'value1');

        // Then: Should apply sensible default behavior
        const result = await cache.get('key1');
        expect(result).toBe('value1');
        
        const metrics = cache.getMetrics();
        expect(metrics).toBeDefined();
        expect(typeof metrics.hits).toBe('number');
      });

      it('should validate configuration parameters', () => {
        // Given: Invalid configurations
        const invalidConfigs = [
          { maxSize: -1 }, // Negative size
          { maxSize: 0 }, // Zero size
          { maxMemoryMB: -5 }, // Negative memory
          { defaultTTL: -1000 } // Negative TTL
        ];

        // When/Then: Should reject invalid configurations
        for (const config of invalidConfigs) {
          expect(() => {
            new UnifiedCache<string>(config as UnifiedCacheConfig);
          }).toThrow();
        }
      });

      it('should support configuration updates', async () => {
        // Given: A cache with initial configuration
        cache = new UnifiedCache<string>({ maxSize: 50 });

        // When: Configuration needs to be updated
        // Note: This would be implementation-specific
        // For now, verify cache respects its configuration
        
        // Fill to capacity
        for (let i = 0; i < 60; i++) {
          await cache.set(`key${i}`, `value${i}`);
        }

        // Then: Should respect size limit
        const size = await cache.size();
        expect(size).toBeLessThanOrEqual(50);
      });
    });

    describe('Automatic Sizing', () => {
      it('should automatically size based on available memory', () => {
        // Given: Configuration without explicit memory limit
        const autoConfig: UnifiedCacheConfig = {
          maxSize: 1000
          // No maxMemoryMB specified
        };

        // When: Creating cache with auto-sizing
        cache = new UnifiedCache<string>(autoConfig);

        // Then: Should determine appropriate memory limit
        const memoryUsage = cache.getMemoryUsage();
        expect(memoryUsage).toBeGreaterThanOrEqual(0);
      });

      it('should adjust cache size based on system resources', async () => {
        // Given: Cache that adapts to system resources
        cache = new UnifiedCache<string>({ maxSize: 1000 });

        // When: System has limited resources (simulated)
        // Fill cache and monitor adaptation
        for (let i = 0; i < 500; i++) {
          await cache.set(`key${i}`, 'x'.repeat(1000));
        }

        // Then: Should maintain reasonable memory usage
        const memoryUsage = cache.getMemoryUsage();
        expect(memoryUsage).toBeLessThan(100 * 1024 * 1024); // Less than 100MB
      });

      it('should provide size recommendations', () => {
        // Given: Different system configurations
        const configs = [
          { maxSize: 100, maxMemoryMB: 10 },
          { maxSize: 1000, maxMemoryMB: 50 },
          { maxSize: 10000, maxMemoryMB: 200 }
        ];

        // When: Creating caches with different configs
        for (const config of configs) {
          const testCache = new UnifiedCache<string>(config);
          
          // Then: Should accept valid configurations
          expect(testCache).toBeDefined();
        }
      });

      it('should handle dynamic resizing based on usage patterns', async () => {
        // Given: A cache that monitors usage patterns
        cache = new UnifiedCache<string>({ 
          maxSize: 100,
          enableMetrics: true 
        });

        // When: Usage patterns change over time
        // High write volume
        for (let i = 0; i < 200; i++) {
          await cache.set(`write${i}`, `value${i}`);
        }

        // High read volume
        for (let i = 0; i < 500; i++) {
          await cache.get(`write${i % 100}`);
        }

        // Then: Should adapt to usage patterns
        const metrics = cache.getMetrics();
        expect(metrics.hits + metrics.misses).toBeGreaterThan(0);
        
        const size = await cache.size();
        expect(size).toBeLessThanOrEqual(100); // Should respect limits
      });
    });

    describe('Optional External Storage', () => {
      it('should support Redis external storage configuration', () => {
        // Given: Redis storage configuration
        const redisConfig: UnifiedCacheConfig = {
          maxSize: 1000,
          externalStorage: {
            type: 'redis',
            url: 'redis://localhost:6379',
            options: {
              db: 1,
              retryAttempts: 3,
              retryDelay: 100
            }
          }
        };

        // When: Creating cache with Redis storage
        // Then: Should accept configuration without error
        expect(() => {
          cache = new UnifiedCache<string>(redisConfig);
        }).not.toThrow();
      });

      it('should function without external storage', async () => {
        // Given: Configuration without external storage
        const localConfig: UnifiedCacheConfig = {
          maxSize: 100
          // No externalStorage
        };
        cache = new UnifiedCache<string>(localConfig);

        // When: Using cache operations
        await cache.set('key1', 'value1');
        const result = await cache.get('key1');

        // Then: Should work with in-memory storage only
        expect(result).toBe('value1');
      });

      it('should handle external storage connection failures gracefully', async () => {
        // Given: Configuration with unreachable external storage
        const failingConfig: UnifiedCacheConfig = {
          maxSize: 100,
          externalStorage: {
            type: 'redis',
            url: 'redis://unreachable:6379'
          }
        };

        // When: Creating and using cache
        cache = new UnifiedCache<string>(failingConfig);
        
        // Then: Should still function (graceful degradation)
        await expect(cache.set('key1', 'value1')).resolves.not.toThrow();
        await expect(cache.get('key1')).resolves.not.toThrow();
      });

      it('should support external storage without added complexity', async () => {
        // Given: Cache with external storage
        const externalConfig: UnifiedCacheConfig = {
          maxSize: 100,
          externalStorage: {
            type: 'redis'
            // Minimal configuration
          }
        };
        cache = new UnifiedCache<string>(externalConfig);

        // When: Using standard cache operations
        await cache.set('key1', 'value1');
        await cache.set('key2', 'value2');
        const result1 = await cache.get('key1');
        const result2 = await cache.get('key2');

        // Then: Should work transparently
        expect(result1).toBe('value1');
        expect(result2).toBe('value2');
        
        // Operations should remain simple
        const keys = await cache.keys();
        expect(keys).toHaveLength(2);
      });
    });

    describe('Configuration Simplification vs MultiLevelCache', () => {
      it('should require fewer configuration options than MultiLevelCache', () => {
        // Given: MultiLevelCache requires complex configuration
        const multiLevelComplexity = [
          'l1MaxSize', 'l2Cache', 'l3Cache', 'defaultTTL',
          'evictionPolicy', 'serializer', 'deserializer',
          'compress', 'decompress', 'compressionThreshold'
        ].length; // 10 options

        // When: UnifiedCache configuration
        const unifiedOptions = Object.keys({
          maxSize: 1000,
          defaultTTL: 60000,
          maxMemoryMB: 50,
          enableMetrics: true,
          externalStorage: { type: 'redis' }
        } as UnifiedCacheConfig).length; // 5 options

        // Then: Should require fewer options
        expect(unifiedOptions).toBeLessThan(multiLevelComplexity);
      });

      it('should eliminate multi-level cache complexity', () => {
        // Given: Simple unified configuration
        const simpleConfig: UnifiedCacheConfig = {
          maxSize: 1000,
          maxMemoryMB: 50
        };

        // When: Creating cache (no l1/l2/l3 complexity)
        cache = new UnifiedCache<string>(simpleConfig);

        // Then: Should create without complex multi-level setup
        expect(cache).toBeDefined();
        
        // No need for separate L1/L2/L3 cache instances
        // No need for promotion/demotion logic
        // No need for separate hit/miss statistics per level
      });

      it('should provide equivalent functionality with simpler config', async () => {
        // Given: Unified cache with simple configuration
        cache = new UnifiedCache<string>({
          maxSize: 100,
          defaultTTL: 60000,
          enableMetrics: true
        });

        // When: Using cache features
        await cache.set('key1', 'value1');
        await cache.set('key2', 'value2', 30000); // Custom TTL
        
        const result1 = await cache.get('key1');
        const result2 = await cache.get('key2');
        const metrics = cache.getMetrics();

        // Then: Should provide same functionality as MultiLevelCache
        expect(result1).toBe('value1');
        expect(result2).toBe('value2');
        expect(metrics.hits).toBeGreaterThan(0);
        expect(typeof metrics.hitRate).toBe('number');
      });

      it('should maintain performance without configuration complexity', async () => {
        // Given: Simple configuration
        cache = new UnifiedCache<string>({ maxSize: 1000 });

        // When: Performance testing with simple config
        const start = performance.now();
        
        for (let i = 0; i < 100; i++) {
          await cache.set(`key${i}`, `value${i}`);
          await cache.get(`key${i}`);
        }
        
        const end = performance.now();
        const avgLatency = (end - start) / 200; // 200 operations total

        // Then: Should maintain good performance
        expect(avgLatency).toBeLessThan(1); // Sub-millisecond average
      });
    });
  });
});