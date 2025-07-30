import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { RateLimiter } from "../../src/utils/rate-limiter.js";

describe('Production Rate Limiting Tests', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up
    if (rateLimiter) {
      await rateLimiter.clear();
    }
  });

  describe('Basic Rate Limiting', () => {
    it('should enforce rate limits correctly', async () => {
      // Given: A rate limiter with 5 requests per 1 second
      rateLimiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 1000,
        keyPrefix: 'test'
      });

      const key = 'user-123';

      // When: Making 5 requests
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.checkLimit(key);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i);
      }

      // Then: 6th request should be blocked
      const blockedResult = await rateLimiter.checkLimit(key);
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.remaining).toBe(0);
      expect(blockedResult.retryAfter).toBeGreaterThan(0);
    });

    it('should reset after window expires', async () => {
      // Given: A rate limiter with short window
      rateLimiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 100,
        keyPrefix: 'test-reset'
      });

      const key = 'user-456';

      // When: Exhausting the limit
      await rateLimiter.checkLimit(key);
      await rateLimiter.checkLimit(key);
      
      const blocked = await rateLimiter.checkLimit(key);
      expect(blocked.allowed).toBe(false);

      // Then: After window expires, should allow again
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const allowed = await rateLimiter.checkLimit(key);
      expect(allowed.allowed).toBe(true);
    });
  });

  describe('Sliding Window vs Fixed Window', () => {
    it('should handle sliding window correctly', async () => {
      // Given: Sliding window rate limiter
      rateLimiter = new RateLimiter({
        maxRequests: 3,
        windowMs: 1000,
        slidingWindow: true
      });

      const key = 'sliding-test';

      // When: Spreading requests over time
      await rateLimiter.checkLimit(key); // t=0
      await new Promise(resolve => setTimeout(resolve, 300));
      await rateLimiter.checkLimit(key); // t=300
      await new Promise(resolve => setTimeout(resolve, 300));
      await rateLimiter.checkLimit(key); // t=600

      // Then: Should still have no requests available
      let result = await rateLimiter.checkLimit(key);
      expect(result.allowed).toBe(false);

      // But after first request expires (at t=1000)
      await new Promise(resolve => setTimeout(resolve, 400));
      result = await rateLimiter.checkLimit(key);
      expect(result.allowed).toBe(true);
    });

    it('should handle fixed window correctly', async () => {
      // Given: Fixed window rate limiter
      rateLimiter = new RateLimiter({
        maxRequests: 3,
        windowMs: 1000,
        slidingWindow: false
      });

      const key = 'fixed-test';

      // When: Making requests at end of window
      await rateLimiter.checkLimit(key);
      await rateLimiter.checkLimit(key);
      await rateLimiter.checkLimit(key);

      // Then: Should be blocked
      let result = await rateLimiter.checkLimit(key);
      expect(result.allowed).toBe(false);

      // And: Should reset at next window boundary
      const currentWindow = Math.floor(Date.now() / 1000) * 1000;
      const nextWindow = currentWindow + 1000;
      const waitTime = nextWindow - Date.now() + 10;
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      result = await rateLimiter.checkLimit(key);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Production Scenarios', () => {
    it('should handle burst traffic', async () => {
      // Given: Rate limiter with realistic settings
      rateLimiter = new RateLimiter({
        maxRequests: 100,
        windowMs: 60000, // 1 minute
        keyPrefix: 'api-endpoint'
      });

      const results = {
        allowed: 0,
        blocked: 0,
        totalTime: 0
      };

      // When: Simulating burst of 150 requests
      const startTime = Date.now();
      const promises = [];

      for (let i = 0; i < 150; i++) {
        promises.push(
          rateLimiter.checkLimit('burst-client').then(result => {
            if (result.allowed) {
              results.allowed++;
            } else {
              results.blocked++;
            }
          })
        );
      }

      await Promise.all(promises);
      results.totalTime = Date.now() - startTime;

      // Then: Should allow exactly 100 and block 50
      expect(results.allowed).toBe(100);
      expect(results.blocked).toBe(50);
      expect(results.totalTime).toBeLessThan(100); // Should be fast
    });

    it('should handle multiple concurrent clients', async () => {
      // Given: Rate limiter with per-client limits
      rateLimiter = new RateLimiter({
        maxRequests: 10,
        windowMs: 1000,
        keyPrefix: 'multi-client'
      });

      // When: Multiple clients make requests concurrently
      const clientPromises = [];
      const clientResults: Record<string, { allowed: number; blocked: number }> = {};

      for (let clientId = 0; clientId < 5; clientId++) {
        const clientKey = `client-${clientId}`;
        clientResults[clientKey] = { allowed: 0, blocked: 0 };

        for (let request = 0; request < 15; request++) {
          clientPromises.push(
            rateLimiter.checkLimit(clientKey).then(result => {
              const clientResult = clientResults[clientKey];
              if (clientResult) {
                if (result.allowed) {
                  clientResult.allowed++;
                } else {
                  clientResult.blocked++;
                }
              }
            })
          );
        }
      }

      await Promise.all(clientPromises);

      // Then: Each client should have their own limit
      Object.values(clientResults).forEach(result => {
        expect(result.allowed).toBe(10);
        expect(result.blocked).toBe(5);
      });
    });

    it('should clean up expired entries efficiently', async () => {
      // Given: Rate limiter with TTL
      rateLimiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 100,
        ttl: 200
      });

      // When: Creating many entries
      for (let i = 0; i < 100; i++) {
        await rateLimiter.checkLimit(`temp-key-${i}`);
      }

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 250));

      // Then: Cleanup should remove all expired entries
      const cleaned = await rateLimiter.cleanup();
      expect(cleaned).toBe(100);
    });

    it('should maintain accuracy under high concurrency', async () => {
      // Given: Rate limiter with strict limit
      rateLimiter = new RateLimiter({
        maxRequests: 50,
        windowMs: 1000,
        slidingWindow: true
      });

      const key = 'concurrent-test';
      let allowedCount = 0;

      // When: 100 concurrent requests from same key
      const promises = Array(100).fill(null).map(() => 
        rateLimiter.checkLimit(key).then(result => {
          if (result.allowed) {
            allowedCount++;
          }
          return result;
        })
      );

      await Promise.all(promises);

      // Then: Should allow exactly the limit
      expect(allowedCount).toBe(50);
    });
  });

  describe('Integration with MCP Server', () => {
    it('should integrate with different MCP endpoints', async () => {
      // Given: Multiple rate limiters for different endpoints
      const captureMemoryLimiter = new RateLimiter({
        maxRequests: 100,
        windowMs: 60000,
        keyPrefix: 'capture-memory'
      });

      const retrieveMemoriesLimiter = new RateLimiter({
        maxRequests: 50,
        windowMs: 60000,
        keyPrefix: 'retrieve-memories'
      });

      const buildContextLimiter = new RateLimiter({
        maxRequests: 20,
        windowMs: 60000,
        keyPrefix: 'build-context'
      });

      // When: Simulating mixed traffic
      const sessionId = 'test-session';
      const results = {
        capture: { allowed: 0, blocked: 0 },
        retrieve: { allowed: 0, blocked: 0 },
        build: { allowed: 0, blocked: 0 }
      };

      // Simulate capture-memory requests
      for (let i = 0; i < 110; i++) {
        const result = await captureMemoryLimiter.checkLimit(sessionId);
        if (result.allowed) {
          results.capture.allowed++;
        } else {
          results.capture.blocked++;
        }
      }

      // Simulate retrieve-memories requests
      for (let i = 0; i < 60; i++) {
        const result = await retrieveMemoriesLimiter.checkLimit(sessionId);
        if (result.allowed) {
          results.retrieve.allowed++;
        } else {
          results.retrieve.blocked++;
        }
      }

      // Simulate build-context requests
      for (let i = 0; i < 25; i++) {
        const result = await buildContextLimiter.checkLimit(sessionId);
        if (result.allowed) {
          results.build.allowed++;
        } else {
          results.build.blocked++;
        }
      }

      // Then: Each endpoint should enforce its own limits
      expect(results.capture.allowed).toBe(100);
      expect(results.capture.blocked).toBe(10);
      expect(results.retrieve.allowed).toBe(50);
      expect(results.retrieve.blocked).toBe(10);
      expect(results.build.allowed).toBe(20);
      expect(results.build.blocked).toBe(5);

      // Cleanup
      await captureMemoryLimiter.clear();
      await retrieveMemoriesLimiter.clear();
      await buildContextLimiter.clear();
    });

    it('should provide proper retry headers', async () => {
      // Given: Rate limiter that's exhausted
      rateLimiter = new RateLimiter({
        maxRequests: 1,
        windowMs: 5000,
        keyPrefix: 'retry-test'
      });

      const key = 'retry-client';

      // When: Exhausting the limit
      await rateLimiter.checkLimit(key);
      const blockedResult = await rateLimiter.checkLimit(key);

      // Then: Should provide retry information
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.retryAfter).toBeGreaterThan(0);
      expect(blockedResult.retryAfter).toBeLessThanOrEqual(5);
      expect(blockedResult.resetAfter).toBeGreaterThan(0);
      expect(blockedResult.resetAfter).toBeLessThanOrEqual(5000);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid configuration', () => {
      // Given/When/Then: Invalid configurations should throw
      expect(() => new RateLimiter({
        maxRequests: 0,
        windowMs: 1000
      })).toThrow('maxRequests must be greater than 0');

      expect(() => new RateLimiter({
        maxRequests: 10,
        windowMs: 0
      })).toThrow('windowMs must be greater than 0');
    });

    it('should handle empty or invalid keys', async () => {
      // Given: Valid rate limiter
      rateLimiter = new RateLimiter({
        maxRequests: 10,
        windowMs: 1000
      });

      // When/Then: Empty key should throw
      await expect(rateLimiter.checkLimit('')).rejects.toThrow('Key is required');
      await expect(rateLimiter.reset('')).rejects.toThrow('Key is required');
      await expect(rateLimiter.getState('')).rejects.toThrow('Key is required');
    });

    it('should handle state queries correctly', async () => {
      // Given: Rate limiter with some usage
      rateLimiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 1000,
        keyPrefix: 'state-test'
      });

      const key = 'state-key';

      // When: Checking state before any requests
      let state = await rateLimiter.getState(key);
      expect(state.allowed).toBe(true);
      expect(state.remaining).toBe(5);

      // After some requests
      await rateLimiter.checkLimit(key);
      await rateLimiter.checkLimit(key);
      
      state = await rateLimiter.getState(key);
      expect(state.allowed).toBe(true);
      expect(state.remaining).toBe(3);

      // After exhausting
      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(key);
      }
      
      state = await rateLimiter.getState(key);
      expect(state.allowed).toBe(false);
      expect(state.remaining).toBe(0);
    });

    it('should handle reset functionality', async () => {
      // Given: Rate limiter with exhausted limit
      rateLimiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 1000
      });

      const key = 'reset-key';
      await rateLimiter.checkLimit(key);
      await rateLimiter.checkLimit(key);

      // When: Resetting the key
      await rateLimiter.reset(key);

      // Then: Should allow requests again
      const result = await rateLimiter.checkLimit(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });
  });
});