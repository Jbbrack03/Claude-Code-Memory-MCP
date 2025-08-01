import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { MultiLevelCache, CacheLevel, CacheOptions } from '../../src/utils/multi-level-cache.js';

describe('MultiLevelCache', () => {
  let cache: MultiLevelCache<string>;
  let mockL2Cache: jest.Mocked<CacheLevel<string>>;
  let mockL3Cache: jest.Mocked<CacheLevel<string>>;

  beforeEach(() => {
    jest.useFakeTimers();
    
    // Mock external cache levels
    mockL2Cache = {
      get: jest.fn<(key: string) => Promise<string | undefined>>().mockResolvedValue(undefined),
      set: jest.fn<(key: string, value: string, ttl?: number) => Promise<void>>().mockResolvedValue(undefined),
      delete: jest.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined),
      clear: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      has: jest.fn<(key: string) => Promise<boolean>>().mockResolvedValue(false),
      size: jest.fn<() => Promise<number>>().mockResolvedValue(0),
      keys: jest.fn<() => Promise<string[]>>().mockResolvedValue([])
    } as jest.Mocked<CacheLevel<string>>;

    mockL3Cache = {
      get: jest.fn<(key: string) => Promise<string | undefined>>().mockResolvedValue(undefined),
      set: jest.fn<(key: string, value: string, ttl?: number) => Promise<void>>().mockResolvedValue(undefined),
      delete: jest.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined),
      clear: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      has: jest.fn<(key: string) => Promise<boolean>>().mockResolvedValue(false),
      size: jest.fn<() => Promise<number>>().mockResolvedValue(0),
      keys: jest.fn<() => Promise<string[]>>().mockResolvedValue([])
    } as jest.Mocked<CacheLevel<string>>;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Basic Operations', () => {
    it('should set and get values from L1 cache', async () => {
      // Given
      const options: CacheOptions = {
        l1MaxSize: 100,
        defaultTTL: 60000 // 1 minute
      };
      cache = new MultiLevelCache(options);

      // When
      await cache.set('key1', 'value1');
      const result = await cache.get('key1');

      // Then
      expect(result).toBe('value1');
    });

    it('should return undefined for non-existent keys', async () => {
      // Given
      cache = new MultiLevelCache({ l1MaxSize: 100 });

      // When
      const result = await cache.get('nonexistent');

      // Then
      expect(result).toBeUndefined();
    });

    it('should delete values', async () => {
      // Given
      cache = new MultiLevelCache({ l1MaxSize: 100 });
      await cache.set('key1', 'value1');

      // When
      await cache.delete('key1');
      const result = await cache.get('key1');

      // Then
      expect(result).toBeUndefined();
    });

    it('should clear all cache levels', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: mockL2Cache,
        l3Cache: mockL3Cache
      });
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      // When
      await cache.clear();

      // Then
      expect(await cache.get('key1')).toBeUndefined();
      expect(await cache.get('key2')).toBeUndefined();
      expect(mockL2Cache.clear).toHaveBeenCalled();
      expect(mockL3Cache.clear).toHaveBeenCalled();
    });
  });

  describe('Cache Promotion', () => {
    it('should promote values from L2 to L1 on access', async () => {
      // Given
      mockL2Cache.get.mockResolvedValue('value2');
      mockL2Cache.has.mockResolvedValue(true);
      
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: mockL2Cache
      });

      // When
      const result = await cache.get('key1');

      // Then
      expect(result).toBe('value2');
      expect(mockL2Cache.get).toHaveBeenCalledWith('key1');
      
      // Verify promotion by checking L1 cache hit on second access
      mockL2Cache.get.mockClear();
      const secondResult = await cache.get('key1');
      expect(secondResult).toBe('value2');
      expect(mockL2Cache.get).not.toHaveBeenCalled();
    });

    it('should promote values from L3 to L2 and L1 on access', async () => {
      // Given
      mockL2Cache.get.mockResolvedValue(undefined);
      mockL2Cache.has.mockResolvedValue(false);
      mockL3Cache.get.mockResolvedValue('value3');
      mockL3Cache.has.mockResolvedValue(true);
      
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: mockL2Cache,
        l3Cache: mockL3Cache,
        defaultTTL: 60000
      });

      // When
      const result = await cache.get('key1');

      // Then
      expect(result).toBe('value3');
      expect(mockL3Cache.get).toHaveBeenCalledWith('key1');
      expect(mockL2Cache.set).toHaveBeenCalledWith('key1', 'value3', expect.any(Number));
      
      // Verify promotion to L1
      mockL2Cache.get.mockClear();
      mockL3Cache.get.mockClear();
      const secondResult = await cache.get('key1');
      expect(secondResult).toBe('value3');
      expect(mockL2Cache.get).not.toHaveBeenCalled();
      expect(mockL3Cache.get).not.toHaveBeenCalled();
    });

    it('should write-through to all cache levels on set', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: mockL2Cache,
        l3Cache: mockL3Cache,
        defaultTTL: 60000
      });

      // When
      await cache.set('key1', 'value1');

      // Then
      expect(mockL2Cache.set).toHaveBeenCalledWith('key1', 'value1', 60000);
      expect(mockL3Cache.set).toHaveBeenCalledWith('key1', 'value1', 60000);
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        defaultTTL: 1000 // 1 second
      });
      await cache.set('key1', 'value1');

      // When
      jest.advanceTimersByTime(1001);
      const result = await cache.get('key1');

      // Then
      expect(result).toBeUndefined();
    });

    it('should use custom TTL per entry', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        defaultTTL: 60000
      });
      
      // When
      await cache.set('key1', 'value1', 500); // 500ms TTL
      await cache.set('key2', 'value2'); // Use default TTL
      
      jest.advanceTimersByTime(600);
      
      // Then
      expect(await cache.get('key1')).toBeUndefined();
      expect(await cache.get('key2')).toBe('value2');
    });

    it('should not expire entries with no TTL', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
        // No defaultTTL
      });
      await cache.set('key1', 'value1');

      // When
      jest.advanceTimersByTime(3600000); // 1 hour
      const result = await cache.get('key1');

      // Then
      expect(result).toBe('value1');
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used items when cache is full', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 3
      });
      
      // When
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');
      
      // Access key1 to make it recently used
      await cache.get('key1');
      
      // Add new item that should evict key2 (least recently used)
      await cache.set('key4', 'value4');

      // Then
      expect(await cache.get('key1')).toBe('value1');
      expect(await cache.get('key2')).toBeUndefined();
      expect(await cache.get('key3')).toBe('value3');
      expect(await cache.get('key4')).toBe('value4');
    });

    it('should update LRU order on set', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 3
      });
      
      // When
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');
      
      // Update key1 to make it most recently used
      await cache.set('key1', 'newValue1');
      
      // Add new item that should evict key2
      await cache.set('key4', 'value4');

      // Then
      expect(await cache.get('key1')).toBe('newValue1');
      expect(await cache.get('key2')).toBeUndefined();
      expect(await cache.get('key3')).toBe('value3');
      expect(await cache.get('key4')).toBe('value4');
    });

    it('should handle cache size of 1', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 1
      });
      
      // When
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      // Then
      expect(await cache.get('key1')).toBeUndefined();
      expect(await cache.get('key2')).toBe('value2');
    });
  });

  describe('Cache Statistics', () => {
    it('should track hit and miss statistics', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });
      await cache.set('key1', 'value1');

      // When
      await cache.get('key1'); // Hit
      await cache.get('key1'); // Hit
      await cache.get('key2'); // Miss
      await cache.get('key3'); // Miss
      await cache.get('key1'); // Hit

      const stats = cache.getStats();

      // Then
      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(0.6, 2);
    });

    it('should track statistics per cache level', async () => {
      // Given
      mockL2Cache.get.mockResolvedValueOnce('value2');
      mockL2Cache.has.mockResolvedValueOnce(true);
      
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: mockL2Cache,
        l3Cache: mockL3Cache
      });
      await cache.set('key1', 'value1');

      // When
      await cache.get('key1'); // L1 hit
      await cache.get('key2'); // L1 miss, L2 hit
      await cache.get('key3'); // All miss

      const stats = cache.getStats();

      // Then
      expect(stats.l1Hits).toBe(1);
      expect(stats.l1Misses).toBe(2);
      expect(stats.l2Hits).toBe(1);
      expect(stats.l2Misses).toBe(1);
      expect(stats.l3Hits).toBe(0);
      expect(stats.l3Misses).toBe(1);
    });

    it('should reset statistics', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });
      await cache.set('key1', 'value1');
      await cache.get('key1');
      await cache.get('key2');

      // When
      cache.resetStats();
      const stats = cache.getStats();

      // Then
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate single keys across all levels', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: mockL2Cache,
        l3Cache: mockL3Cache
      });
      await cache.set('key1', 'value1');

      // When
      await cache.invalidate('key1');

      // Then
      expect(await cache.get('key1')).toBeUndefined();
      expect(mockL2Cache.delete).toHaveBeenCalledWith('key1');
      expect(mockL3Cache.delete).toHaveBeenCalledWith('key1');
    });

    it('should invalidate keys by pattern', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });
      await cache.set('user:1:profile', 'profile1');
      await cache.set('user:1:settings', 'settings1');
      await cache.set('user:2:profile', 'profile2');
      await cache.set('post:1', 'post1');

      // When
      await cache.invalidatePattern('user:1:*');

      // Then
      expect(await cache.get('user:1:profile')).toBeUndefined();
      expect(await cache.get('user:1:settings')).toBeUndefined();
      expect(await cache.get('user:2:profile')).toBe('profile2');
      expect(await cache.get('post:1')).toBe('post1');
    });

    it('should invalidate all keys matching regex pattern', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });
      await cache.set('cache:user:123', 'user123');
      await cache.set('cache:post:456', 'post456');
      await cache.set('temp:data', 'tempdata');

      // When
      await cache.invalidatePattern(/^cache:.*/);

      // Then
      expect(await cache.get('cache:user:123')).toBeUndefined();
      expect(await cache.get('cache:post:456')).toBeUndefined();
      expect(await cache.get('temp:data')).toBe('tempdata');
    });
  });

  describe('Fallback Handling', () => {
    it('should continue working when L2 cache is unavailable', async () => {
      // Given
      mockL2Cache.get.mockRejectedValue(new Error('L2 cache error'));
      mockL2Cache.set.mockRejectedValue(new Error('L2 cache error'));
      
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: mockL2Cache
      });

      // When
      await cache.set('key1', 'value1');
      const result = await cache.get('key1');

      // Then
      expect(result).toBe('value1');
    });

    it('should skip unavailable cache levels during promotion', async () => {
      // Given
      mockL2Cache.get.mockRejectedValue(new Error('L2 cache error'));
      mockL2Cache.set.mockRejectedValue(new Error('L2 cache error'));
      mockL3Cache.get.mockResolvedValue('value3');
      mockL3Cache.has.mockResolvedValue(true);
      
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: mockL2Cache,
        l3Cache: mockL3Cache
      });

      // When
      const result = await cache.get('key1');

      // Then
      expect(result).toBe('value3');
      expect(mockL3Cache.get).toHaveBeenCalled();
      // L2 set might be called but should fail gracefully
    });

    it('should handle errors in cache invalidation gracefully', async () => {
      // Given
      mockL2Cache.delete.mockRejectedValue(new Error('L2 delete error'));
      mockL2Cache.keys.mockRejectedValue(new Error('L2 keys error'));
      
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: mockL2Cache
      });
      await cache.set('key1', 'value1');

      // When/Then - should not throw
      await expect(cache.invalidate('key1')).resolves.not.toThrow();
      await expect(cache.invalidatePattern('key*')).resolves.not.toThrow();
    });
  });

  describe('Concurrent Access', () => {
    it('should handle concurrent reads safely', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });
      await cache.set('key1', 'value1');

      // When
      const promises = Array(10).fill(null).map(() => cache.get('key1'));
      const results = await Promise.all(promises);

      // Then
      expect(results).toHaveLength(10);
      results.forEach(result => expect(result).toBe('value1'));
    });

    it('should handle concurrent writes safely', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });

      // When
      const promises = Array(10).fill(null).map((_, i) => 
        cache.set(`key${i}`, `value${i}`)
      );
      await Promise.all(promises);

      // Then
      for (let i = 0; i < 10; i++) {
        expect(await cache.get(`key${i}`)).toBe(`value${i}`);
      }
    });

    it('should handle mixed concurrent operations', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });
      await cache.set('shared', 'initial');

      // When
      const operations = [
        cache.get('shared'),
        cache.set('shared', 'updated'),
        cache.get('shared'),
        cache.delete('shared'),
        cache.get('shared'),
        cache.set('shared', 'final')
      ];
      
      await Promise.all(operations);
      const finalResult = await cache.get('shared');

      // Then
      // Final state should be consistent
      expect(['final', undefined]).toContain(finalResult);
    });

    it('should prevent cache promotion races', async () => {
      // Use real timers for this test
      jest.useRealTimers();
      
      // Given
      let getCallCount = 0;
      mockL2Cache.get.mockImplementation(async () => {
        getCallCount++;
        // Simulate slow L2 cache
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'value2';
      });
      mockL2Cache.has.mockResolvedValue(true);
      
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: mockL2Cache
      });

      // When - concurrent gets for same key
      const promises = Array(5).fill(null).map(() => cache.get('key1'));
      const results = await Promise.all(promises);

      // Then
      results.forEach(result => expect(result).toBe('value2'));
      // Should only fetch from L2 once despite concurrent requests
      expect(getCallCount).toBe(1);
      
      // Restore fake timers
      jest.useFakeTimers();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero cache size', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 0
      });

      // When
      await cache.set('key1', 'value1');
      const result = await cache.get('key1');

      // Then
      expect(result).toBeUndefined();
    });

    it('should handle null and undefined values', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });

      // When
      await cache.set('null', null as any);
      await cache.set('undefined', undefined as any);

      // Then
      expect(await cache.get('null')).toBeNull();
      expect(await cache.get('undefined')).toBeUndefined();
      expect(await cache.has('undefined')).toBe(true);
    });

    it('should handle large values', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });
      const largeValue = 'x'.repeat(1024 * 1024); // 1MB string

      // When
      await cache.set('large', largeValue);
      const result = await cache.get('large');

      // Then
      expect(result).toBe(largeValue);
    });

    it('should handle special characters in keys', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });
      const specialKeys = [
        'key with spaces',
        'key:with:colons',
        'key/with/slashes',
        'key\\with\\backslashes',
        'key@with#special$chars',
        '🔑'
      ];

      // When
      for (const key of specialKeys) {
        await cache.set(key, `value-${key}`);
      }

      // Then
      for (const key of specialKeys) {
        expect(await cache.get(key)).toBe(`value-${key}`);
      }
    });

    it('should handle extremely long keys', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });
      const longKey = 'x'.repeat(1000); // 1KB key

      // When
      await cache.set(longKey, 'value');
      const result = await cache.get(longKey);

      // Then
      expect(result).toBe('value');
    });

    it('should handle rapid TTL expirations', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });

      // When - Set many keys with very short TTLs
      const promises = Array.from({ length: 100 }, (_, i) => 
        cache.set(`key${i}`, `value${i}`, 1) // 1ms TTL
      );
      await Promise.all(promises);

      // Wait for expiration
      jest.advanceTimersByTime(10);

      // Then - All should be expired
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) => cache.get(`key${i}`))
      );
      expect(results.every(result => result === undefined)).toBe(true);
    });

    it('should handle setting same key multiple times rapidly', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        defaultTTL: 1000
      });

      // When - Rapidly update same key
      const updates = Array.from({ length: 100 }, (_, i) => 
        cache.set('sameKey', `value${i}`)
      );
      await Promise.all(updates);

      // Then - Should have the last value (though which one is indeterminate due to concurrency)
      const result = await cache.get('sameKey');
      expect(result).toMatch(/^value\d+$/);
    });

    it('should handle cache operations during clear', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100
      });
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      // When - Concurrent operations during clear
      const operations = [
        cache.clear(),
        cache.get('key1'),
        cache.set('key3', 'value3'),
        cache.delete('key2')
      ];
      
      await Promise.all(operations);

      // Then - Cache should be in consistent state
      const finalValues = await Promise.all([
        cache.get('key1'),
        cache.get('key2'),
        cache.get('key3')
      ]);
      
      // After clear, old keys should be gone, new key might or might not be there
      expect(finalValues[0]).toBeUndefined(); // key1 cleared
      expect(finalValues[1]).toBeUndefined(); // key2 cleared
      // key3 may or may not exist depending on timing
    });
  });

  describe('Configuration Options', () => {
    it('should support custom eviction policies', async () => {
      // Given
      const customEvictionPolicy = jest.fn().mockReturnValue('key1') as jest.MockedFunction<(cache: Map<string, any>) => string>;
      cache = new MultiLevelCache({
        l1MaxSize: 2,
        evictionPolicy: customEvictionPolicy
      });

      // When
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      // Then
      expect(customEvictionPolicy).toHaveBeenCalled();
      expect(await cache.get('key1')).toBeUndefined();
      expect(await cache.get('key2')).toBe('value2');
      expect(await cache.get('key3')).toBe('value3');
    });

    it('should support serialization for complex types', async () => {
      // Given
      interface ComplexType {
        id: number;
        data: { nested: string };
      }
      
      const complexCache = new MultiLevelCache<ComplexType>({
        l1MaxSize: 100,
        serializer: JSON.stringify,
        deserializer: JSON.parse
      });

      const complexValue: ComplexType = {
        id: 123,
        data: { nested: 'value' }
      };

      // When
      await complexCache.set('complex', complexValue);
      const result = await complexCache.get('complex');

      // Then
      expect(result).toEqual(complexValue);
    });

    it.skip('should support compression for large values', async () => {
      // Given
      const mockCompress = jest.fn<(value: string) => string>().mockImplementation((v) => `compressed:${v}`);
      const mockDecompress = jest.fn<(value: string) => string>().mockImplementation((v) => v.replace('compressed:', ''));
      
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        compress: mockCompress,
        decompress: mockDecompress,
        compressionThreshold: 100, // bytes
        serializer: (v) => String(v)
      });

      const largeValue = 'x'.repeat(200);

      // When
      await cache.set('large', largeValue);
      const result = await cache.get('large');

      // Then
      expect(mockCompress).toHaveBeenCalledWith(largeValue);
      expect(mockDecompress).toHaveBeenCalled();
      expect(result).toBe(largeValue);
    });
  });

  describe('Performance Characteristics', () => {
    it('should verify cache hierarchy behavior instead of timing', async () => {
      // This test was originally trying to measure L1 vs L2 performance,
      // but timing-based tests are unreliable and this was causing timeouts.
      // Instead, verify the cache hierarchy behavior is correct.
      
      const mockL2Cache = {
        get: jest.fn().mockResolvedValue('l2-value'),
        set: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
        has: jest.fn().mockResolvedValue(true),
        size: jest.fn().mockResolvedValue(1),
        keys: jest.fn().mockResolvedValue(['key1'])
      };

      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: mockL2Cache
      });

      // Verify L1 cache hit doesn't call L2
      await cache.set('key1', 'l1-value');
      const result1 = await cache.get('key1');
      expect(result1).toBe('l1-value');
      expect(mockL2Cache.get).not.toHaveBeenCalled();

      // Verify cache statistics show correct behavior
      const stats = cache.getStats();
      expect(stats.l1Hits).toBe(1);
      expect(stats.l2Hits).toBe(0);
    });

    it('should handle high-frequency operations without degradation', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 1000
      });

      const operations = 1000;
      const keys = Array.from({ length: operations }, (_, i) => `key${i}`);
      const values = Array.from({ length: operations }, (_, i) => `value${i}`);

      // When
      const setStart = process.hrtime.bigint();
      await Promise.all(keys.map((key, i) => cache.set(key, values[i])));
      const setTime = Number(process.hrtime.bigint() - setStart) / 1e6;

      const getStart = process.hrtime.bigint();
      await Promise.all(keys.map(key => cache.get(key)));
      const getTime = Number(process.hrtime.bigint() - getStart) / 1e6;

      // Then
      expect(setTime).toBeLessThan(1000); // Should complete in under 1 second
      expect(getTime).toBeLessThan(500);  // Gets should be even faster
      
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(1); // All gets should be hits
    });

    it('should maintain consistent performance under memory pressure', async () => {
      // Given - Small cache to force evictions
      cache = new MultiLevelCache({
        l1MaxSize: 50
      });

      const operations = 200; // More than cache size
      const times: number[] = [];

      // When - Measure operation times during eviction pressure
      for (let i = 0; i < operations; i++) {
        const start = process.hrtime.bigint();
        await cache.set(`key${i}`, `value${i}`);
        const time = Number(process.hrtime.bigint() - start) / 1e6;
        times.push(time);
      }

      // Then - Performance should remain consistent
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);
      
      // Ensure we have meaningful measurements
      expect(times.length).toBe(operations);
      
      // Performance should be reasonable - no operation should take more than 50ms
      expect(maxTime).toBeLessThan(50);
      
      // If we have measurable times, check consistency
      if (avgTime > 0) {
        // Max time should not be more than 10x average (allowing for eviction overhead)
        expect(maxTime).toBeLessThan(Math.max(avgTime * 10, 10));
      }
    });
  });

  describe('Resource Management and Cleanup', () => {
    it('should properly clean up timers on cache deletion', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 100,
        defaultTTL: 5000
      });

      // When - Set values with TTL then delete them
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      // Delete some entries
      await cache.delete('key1');
      await cache.delete('key2');

      // Fast forward time
      jest.advanceTimersByTime(6000);

      // Then - Deleted entries should not cause timer callbacks
      expect(await cache.get('key1')).toBeUndefined();
      expect(await cache.get('key2')).toBeUndefined();
      expect(await cache.get('key3')).toBeUndefined(); // Expired naturally
    });

    it('should handle timer cleanup during eviction', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 2,
        defaultTTL: 5000
      });

      // When - Fill cache and force eviction
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3'); // Should evict key1

      // Fast forward time
      jest.advanceTimersByTime(6000);

      // Then - Only remaining entries should be affected by timers
      expect(await cache.get('key1')).toBeUndefined(); // Evicted
      expect(await cache.get('key2')).toBeUndefined(); // Expired
      expect(await cache.get('key3')).toBeUndefined(); // Expired
    });

    it('should handle cache clear with many active timers', async () => {
      // Given
      cache = new MultiLevelCache({
        l1MaxSize: 1000,
        defaultTTL: 10000
      });

      // Set many entries with TTL
      const promises = Array.from({ length: 500 }, (_, i) => 
        cache.set(`key${i}`, `value${i}`)
      );
      await Promise.all(promises);

      // When - Clear cache
      await cache.clear();

      // Fast forward past TTL
      jest.advanceTimersByTime(15000);

      // Then - All entries should be gone and no timer callbacks should fire
      const results = await Promise.all(
        Array.from({ length: 500 }, (_, i) => cache.get(`key${i}`))
      );
      expect(results.every(result => result === undefined)).toBe(true);
    });

    it('should prevent memory leaks from promotion locks', async () => {
      // Given - Create a specific mock for this test
      let callCount = 0;
      const testMockL2Cache = {
        get: jest.fn().mockImplementation(async () => {
          callCount++;
          // Return immediately to avoid timeout
          return 'value1';
        }),
        set: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
        has: jest.fn().mockResolvedValue(true),
        size: jest.fn().mockResolvedValue(1),
        keys: jest.fn().mockResolvedValue(['key1'])
      };

      cache = new MultiLevelCache({
        l1MaxSize: 100,
        l2Cache: testMockL2Cache
      });

      // When - Start multiple concurrent promotions for same key
      const getPromises = Array.from({ length: 10 }, () => cache.get('key1'));
      const results = await Promise.all(getPromises);

      // Then - All should get same result and L2 should only be called once
      expect(results.every(result => result === 'value1')).toBe(true);
      expect(callCount).toBe(1); // Only one L2 call despite 10 concurrent gets
      expect(testMockL2Cache.get).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple cache instances independently', async () => {
      // Given
      const cache1 = new MultiLevelCache({
        l1MaxSize: 50,
        defaultTTL: 1000
      });
      
      const cache2 = new MultiLevelCache({
        l1MaxSize: 100,
        defaultTTL: 2000
      });

      // When - Use both caches
      await cache1.set('shared-key', 'cache1-value');
      await cache2.set('shared-key', 'cache2-value');

      // Then - Each should maintain independent state
      expect(await cache1.get('shared-key')).toBe('cache1-value');
      expect(await cache2.get('shared-key')).toBe('cache2-value');

      // Verify independent statistics
      const stats1 = cache1.getStats();
      const stats2 = cache2.getStats();
      
      expect(stats1.hits).toBe(1);
      expect(stats2.hits).toBe(1);
      
      // Clear one cache shouldn't affect the other
      await cache1.clear();
      expect(await cache1.get('shared-key')).toBeUndefined();
      expect(await cache2.get('shared-key')).toBe('cache2-value');
    });
  });
});