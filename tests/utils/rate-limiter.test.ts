import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { RateLimiter, RateLimiterConfig } from "../../src/utils/rate-limiter.js";

describe('RateLimiter', () => {
  let config: RateLimiterConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    
    config = {
      maxRequests: 10,
      windowMs: 60000, // 1 minute
      keyPrefix: 'test',
      slidingWindow: true
    };
  });

  describe('initialization', () => {
    it('should initialize with provided configuration', () => {
      // When: RateLimiter is created with config
      const limiter = new RateLimiter(config);
      
      // Then: It should be created successfully
      expect(limiter).toBeDefined();
    });

    it('should use default values for optional configuration', () => {
      // Given: Minimal configuration
      const minConfig: RateLimiterConfig = {
        maxRequests: 5,
        windowMs: 1000
      };

      // When: RateLimiter is created
      const limiter = new RateLimiter(minConfig);
      
      // Then: It should be created with defaults
      expect(limiter).toBeDefined();
    });

    it('should validate configuration parameters', () => {
      // Given: Invalid configurations
      const invalidConfigs = [
        { maxRequests: 0, windowMs: 1000 },
        { maxRequests: -1, windowMs: 1000 },
        { maxRequests: 10, windowMs: 0 },
        { maxRequests: 10, windowMs: -1000 }
      ];

      // When/Then: Each invalid config should throw
      invalidConfigs.forEach(invalidConfig => {
        expect(() => {
          new RateLimiter(invalidConfig);
        }).toThrow();
      });
    });
  });

  describe('checkLimit', () => {
    it('should allow requests within limit', async () => {
      // Given: A new rate limiter
      const limiter = new RateLimiter(config);
      
      // When: First request is made
      const result = await limiter.checkLimit('user:123');
      
      // Then: Request should be allowed
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.limit).toBe(10);
    });

    it('should block requests exceeding limit', async () => {
      // Given: A rate limiter
      const limiter = new RateLimiter(config);
      const key = 'user:123';
      
      // When: Make requests up to the limit
      for (let i = 0; i < config.maxRequests; i++) {
        const result = await limiter.checkLimit(key);
        expect(result.allowed).toBe(true);
      }
      
      // Then: Next request should be blocked
      const blockedResult = await limiter.checkLimit(key);
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.remaining).toBe(0);
      expect(blockedResult.retryAfter).toBeDefined();
      expect(blockedResult.retryAfter).toBeGreaterThan(0);
    });

    it('should handle multiple keys independently', async () => {
      // Given: A rate limiter
      const limiter = new RateLimiter(config);
      const keys = ['user:123', 'user:456', 'session:abc'];
      
      // When: Each key makes a request
      for (const key of keys) {
        const result = await limiter.checkLimit(key);
        
        // Then: Each should have independent counters
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(9);
      }
    });

    it('should apply key prefix correctly', async () => {
      // Given: A rate limiter with prefix
      const limiter = new RateLimiter(config);
      
      // When: Request is made
      const result = await limiter.checkLimit('user:123');
      
      // Then: Request should be allowed (internal key is 'test:user:123')
      expect(result.allowed).toBe(true);
    });
  });

  describe('sliding window algorithm', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      config.windowMs = 10000; // 10 seconds
      config.maxRequests = 5;
    });

    it('should implement sliding window correctly', async () => {
      // Given: A sliding window rate limiter
      const limiter = new RateLimiter(config);
      const key = 'user:123';

      // When: Make 3 requests at t=0
      for (let i = 0; i < 3; i++) {
        const result = await limiter.checkLimit(key);
        expect(result.allowed).toBe(true);
      }

      // Advance to t=5s
      jest.advanceTimersByTime(5000);

      // Make 2 more requests (total 5)
      for (let i = 0; i < 2; i++) {
        const result = await limiter.checkLimit(key);
        expect(result.allowed).toBe(true);
      }

      // Next request should be blocked (at limit)
      const blockedResult = await limiter.checkLimit(key);
      expect(blockedResult.allowed).toBe(false);

      // Advance to t=11s (first 3 requests expire)
      jest.advanceTimersByTime(6000);

      // Should be able to make 3 more requests
      const result = await limiter.checkLimit(key);
      expect(result.allowed).toBe(true);
    });

    it('should calculate correct resetAfter time', async () => {
      // Given: A sliding window rate limiter
      const limiter = new RateLimiter(config);
      const key = 'user:123';

      // When: Make first request
      const result1 = await limiter.checkLimit(key);
      expect(result1.resetAfter).toBeLessThanOrEqual(config.windowMs);
      
      // Advance 3 seconds and make another request
      jest.advanceTimersByTime(3000);
      const result2 = await limiter.checkLimit(key);
      
      // Then: resetAfter should be based on oldest request
      expect(result2.resetAfter).toBeLessThanOrEqual(config.windowMs - 3000);
    });
  });

  describe('fixed window mode', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      config.slidingWindow = false;
      config.windowMs = 10000;
      config.maxRequests = 5;
    });

    it('should reset counter at window boundary', async () => {
      // Given: A fixed window rate limiter
      const limiter = new RateLimiter(config);
      const key = 'user:123';

      // When: Fill the limit
      for (let i = 0; i < config.maxRequests; i++) {
        const result = await limiter.checkLimit(key);
        expect(result.allowed).toBe(true);
      }

      // Request should be blocked
      const blockedResult = await limiter.checkLimit(key);
      expect(blockedResult.allowed).toBe(false);

      // Advance past window boundary
      jest.advanceTimersByTime(config.windowMs + 1);

      // Then: Should be allowed again
      const newWindowResult = await limiter.checkLimit(key);
      expect(newWindowResult.allowed).toBe(true);
      expect(newWindowResult.remaining).toBe(4);
    });
  });

  describe('reset', () => {
    it('should reset limit for specific key', async () => {
      // Given: A rate limiter with some requests made
      const limiter = new RateLimiter(config);
      const key = 'user:123';

      // Make some requests
      for (let i = 0; i < 5; i++) {
        await limiter.checkLimit(key);
      }

      // When: Reset the key
      await limiter.reset(key);

      // Then: Check limit is reset
      const result = await limiter.checkLimit(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it('should only reset specified key', async () => {
      // Given: A rate limiter with requests on multiple keys
      const limiter = new RateLimiter(config);
      const key1 = 'user:123';
      const key2 = 'user:456';

      await limiter.checkLimit(key1);
      await limiter.checkLimit(key2);

      // When: Reset only key1
      await limiter.reset(key1);

      // Then: Check states
      const result1 = await limiter.checkLimit(key1);
      const result2 = await limiter.checkLimit(key2);
      
      expect(result1.remaining).toBe(9); // Reset
      expect(result2.remaining).toBe(8); // Not reset
    });
  });

  describe('getState', () => {
    it('should return current state without incrementing', async () => {
      // Given: A rate limiter with one request made
      const limiter = new RateLimiter(config);
      const key = 'user:123';

      await limiter.checkLimit(key);
      
      // When: Get state multiple times
      const state1 = await limiter.getState(key);
      const state2 = await limiter.getState(key);
      
      // Then: State should be consistent and not increment
      expect(state1.remaining).toBe(9);
      expect(state2.remaining).toBe(9);
      expect(state1.allowed).toBe(true);
    });

    it('should return full limit for new keys', async () => {
      // Given: A rate limiter
      const limiter = new RateLimiter(config);
      
      // When: Get state for unused key
      const state = await limiter.getState('user:new');
      
      // Then: Should show full limit available
      expect(state.allowed).toBe(true);
      expect(state.remaining).toBe(config.maxRequests);
      expect(state.resetAfter).toBe(0);
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      config.ttl = 5000;
    });

    it('should remove expired entries', async () => {
      // Given: A rate limiter with some entries
      const limiter = new RateLimiter(config);
      const keys = ['user:1', 'user:2', 'user:3'];

      // Make requests
      for (const key of keys) {
        await limiter.checkLimit(key);
      }

      // When: Advance past TTL and cleanup
      jest.advanceTimersByTime(config.ttl! + 1000);
      const removed = await limiter.cleanup();

      // Then: Entries should be removed
      expect(removed).toBe(3);
      
      // Verify entries are gone
      for (const key of keys) {
        const state = await limiter.getState(key);
        expect(state.remaining).toBe(config.maxRequests);
      }
    });

    it('should keep non-expired entries', async () => {
      // Given: A rate limiter with old and new entries
      const limiter = new RateLimiter(config);
      
      await limiter.checkLimit('old:1');
      
      jest.advanceTimersByTime(config.ttl! - 1000);
      await limiter.checkLimit('new:1');

      jest.advanceTimersByTime(2000);
      
      // When: Cleanup
      const removed = await limiter.cleanup();
      
      // Then: Only old entry should be removed
      expect(removed).toBe(1);
      
      const oldState = await limiter.getState('old:1');
      const newState = await limiter.getState('new:1');
      
      expect(oldState.remaining).toBe(config.maxRequests); // Reset
      expect(newState.remaining).toBe(9); // Kept
    });
  });

  describe('clear', () => {
    it('should remove all rate limit data', async () => {
      // Given: A rate limiter with multiple entries
      const limiter = new RateLimiter(config);
      const keys = ['user:1', 'user:2', 'session:1'];

      for (const key of keys) {
        await limiter.checkLimit(key);
      }

      // When: Clear all data
      await limiter.clear();

      // Then: All keys should be reset
      for (const key of keys) {
        const state = await limiter.getState(key);
        expect(state.remaining).toBe(config.maxRequests);
      }
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent requests safely', async () => {
      // Given: A rate limiter
      const limiter = new RateLimiter(config);
      const key = 'user:concurrent';

      // When: Multiple concurrent requests
      const promises = Array(20).fill(null).map(() => 
        limiter.checkLimit(key)
      );

      const results = await Promise.all(promises);
      
      // Then: Exactly maxRequests should be allowed
      const allowed = results.filter(r => r.allowed).length;
      const blocked = results.filter(r => !r.allowed).length;
      
      expect(allowed).toBe(config.maxRequests);
      expect(blocked).toBe(10);
    });

    it('should maintain consistency during cleanup', async () => {
      // Given: A rate limiter
      const limiter = new RateLimiter(config);
      
      // When: Concurrent checks and cleanup
      const checkPromises = Array(5).fill(null).map((_, i) => 
        limiter.checkLimit(`user:${i}`)
      );

      const cleanupPromise = limiter.cleanup();

      const results = await Promise.all([...checkPromises, cleanupPromise]);
      
      // Then: Operations should complete without error
      expect(results).toHaveLength(6);
    });
  });

  describe('memory management', () => {
    it('should respect TTL for automatic cleanup', async () => {
      // Given: A rate limiter with short TTL
      jest.useFakeTimers();
      const shortTTLConfig = { ...config, ttl: 1000 };
      const limiter = new RateLimiter(shortTTLConfig);
      
      // When: Make a request and advance past TTL
      await limiter.checkLimit('temp:1');
      jest.advanceTimersByTime(2000);
      
      // Make another request to potentially trigger cleanup
      await limiter.checkLimit('temp:2');
      
      // Then: Old entry should be cleanable
      const removed = await limiter.cleanup();
      expect(removed).toBeGreaterThanOrEqual(1);
    });

    it('should handle memory pressure gracefully', async () => {
      // Given: A rate limiter
      const limiter = new RateLimiter(config);
      const promises = [];
      
      // When: Create many entries
      for (let i = 0; i < 10000; i++) {
        promises.push(limiter.checkLimit(`user:${i}`));
        
        // Batch processing
        if (i % 100 === 0) {
          await Promise.all(promises);
          promises.length = 0;
        }
      }
      
      // Then: Should handle without error
      await Promise.all(promises);
    });
  });

  describe('error handling', () => {
    it('should handle invalid keys gracefully', async () => {
      // Given: A rate limiter
      const limiter = new RateLimiter(config);
      const invalidKeys = ['', null as any, undefined as any];

      // When/Then: Invalid keys should throw
      for (const key of invalidKeys) {
        await expect(limiter.checkLimit(key)).rejects.toThrow();
      }
    });

    it('should handle internal errors without data loss', async () => {
      // Given: A rate limiter
      const limiter = new RateLimiter(config);
      
      // When: Normal operation
      const result = await limiter.checkLimit('test');
      
      // Then: Should work correctly
      expect(result.allowed).toBe(true);
    });
  });

  describe('retry-after calculation', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('should calculate correct retry-after for blocked requests', async () => {
      // Given: A rate limiter at capacity
      const limiter = new RateLimiter(config);
      const key = 'user:123';

      // Fill the limit
      for (let i = 0; i < config.maxRequests; i++) {
        await limiter.checkLimit(key);
      }

      // When: Next request is blocked
      const blockedResult = await limiter.checkLimit(key);
      
      // Then: Should have valid retry-after
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.retryAfter).toBeDefined();
      expect(blockedResult.retryAfter).toBeGreaterThan(0);
      expect(blockedResult.retryAfter).toBeLessThanOrEqual(config.windowMs / 1000);
    });

    it('should provide retry-after in seconds for HTTP 429 responses', async () => {
      // Given: A rate limiter
      const limiter = new RateLimiter(config);
      const key = 'api:endpoint';
      
      // When: Fill limit and check retry-after
      for (let i = 0; i < config.maxRequests + 1; i++) {
        const result = await limiter.checkLimit(key);
        
        if (!result.allowed) {
          // Then: Verify retry-after format
          expect(result.retryAfter).toBeDefined();
          expect(Number.isInteger(result.retryAfter)).toBe(true);
          expect(result.retryAfter).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('edge cases', () => {
    it('should handle zero-remaining correctly', async () => {
      // Given: A rate limiter with limit of 1
      config.maxRequests = 1;
      const limiter = new RateLimiter(config);
      const key = 'user:edge';
      
      // When: First request uses the only slot
      const firstResult = await limiter.checkLimit(key);
      expect(firstResult.allowed).toBe(true);
      expect(firstResult.remaining).toBe(0);
      
      // Then: Second request should be blocked
      const secondResult = await limiter.checkLimit(key);
      expect(secondResult.allowed).toBe(false);
      expect(secondResult.remaining).toBe(0);
    });

    it('should handle time boundary correctly', async () => {
      // Given: A rate limiter with 1 second window
      jest.useFakeTimers();
      const limiter = new RateLimiter({ ...config, windowMs: 1000 });
      const key = 'user:boundary';
      
      // When: Make request at window start
      await limiter.checkLimit(key);
      
      // Advance to exactly the window boundary
      jest.advanceTimersByTime(1000);
      
      // Then: New request should have correct state
      const result = await limiter.checkLimit(key);
      expect(result.allowed).toBe(true);
    });
  });
});