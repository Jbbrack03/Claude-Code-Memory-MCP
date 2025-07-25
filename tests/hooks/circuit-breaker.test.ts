import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { CircuitBreaker } from "../../src/hooks/circuit-breaker.js";

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('circuit states', () => {
    it('should open circuit after failure threshold', async () => {
      // Given: Circuit breaker with threshold of 3
      cb = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 1000
      });
      
      const failingOperation = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Failed'));
      
      // When: Operation fails 3 times
      for (let i = 0; i < 3; i++) {
        await expect(cb.execute('test', failingOperation)).rejects.toThrow('Failed');
      }
      
      // Then: Circuit opens and rejects immediately
      await expect(cb.execute('test', failingOperation))
        .rejects.toThrow('Circuit breaker is open');
      expect(failingOperation).toHaveBeenCalledTimes(3); // Not called on 4th attempt
    });

    it('should enter half-open state after reset timeout', async () => {
      // Given: Open circuit
      jest.useFakeTimers();
      cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 100,
        halfOpenRequests: 1
      });
      
      const failingOp = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Failed'));
      await expect(cb.execute('test', failingOp)).rejects.toThrow('Failed');
      
      // When: Reset timeout passes
      jest.advanceTimersByTime(150);
      
      // Then: Circuit is half-open and allows one request
      const successOp = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      expect(await cb.execute('test', successOp)).toBe('success');
      expect(cb.getState('test')).toBe('closed');
    });

    it('should return to open state if half-open request fails', async () => {
      // Given: Circuit in half-open state
      jest.useFakeTimers();
      cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 100,
        halfOpenRequests: 1
      });
      
      const failingOp = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Failed'));
      await expect(cb.execute('test', failingOp)).rejects.toThrow('Failed');
      
      // Move to half-open
      jest.advanceTimersByTime(150);
      
      // When: Half-open request fails
      await expect(cb.execute('test', failingOp)).rejects.toThrow('Failed');
      
      // Then: Circuit returns to open
      await expect(cb.execute('test', failingOp))
        .rejects.toThrow('Circuit breaker is open');
      expect(failingOp).toHaveBeenCalledTimes(2); // Only called twice
    });

    it('should close circuit after successful requests in half-open state', async () => {
      // Given: Circuit in half-open state
      jest.useFakeTimers();
      cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 100,
        halfOpenRequests: 2
      });
      
      const failingOp = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Failed'));
      await expect(cb.execute('test', failingOp)).rejects.toThrow('Failed');
      
      // Move to half-open
      jest.advanceTimersByTime(150);
      
      // When: Half-open requests succeed
      const successOp = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      expect(await cb.execute('test', successOp)).toBe('success');
      expect(await cb.execute('test', successOp)).toBe('success');
      
      // Then: Circuit is closed
      expect(cb.getState('test')).toBe('closed');
    });
  });

  describe('operation isolation', () => {
    it('should track circuits per operation', async () => {
      // Given: Different operations
      cb = new CircuitBreaker({ failureThreshold: 1 });
      
      const failingOp = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Failed'));
      const successOp = jest.fn<() => Promise<string>>().mockResolvedValue('ok');
      
      // When: One operation fails
      await expect(cb.execute('op1', failingOp)).rejects.toThrow('Failed');
      
      // Then: Other operations still work
      expect(await cb.execute('op2', successOp)).toBe('ok');
      expect(cb.getState('op1')).toBe('open');
      expect(cb.getState('op2')).toBe('closed');
    });

    it('should handle concurrent operations correctly', async () => {
      // Given: Circuit breaker with threshold of 2
      cb = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 1000
      });
      
      const failingOp = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Failed'));
      
      // When: Multiple concurrent failures
      const promises = Array(5).fill(null).map(() => 
        cb.execute('test', failingOp).catch(() => {})
      );
      
      await Promise.all(promises);
      
      // Then: Circuit opens after threshold
      expect(cb.getState('test')).toBe('open');
      // Operation called at most threshold times (might be less due to race conditions)
      expect(failingOp.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  describe('configuration', () => {
    it('should use default configuration if not provided', () => {
      // Given: No configuration
      cb = new CircuitBreaker();
      
      // Then: Has sensible defaults
      expect(cb.getState('any')).toBe('closed');
    });

    it('should validate configuration', () => {
      // Given: Invalid configurations
      // Then: Should throw
      expect(() => new CircuitBreaker({ failureThreshold: 0 }))
        .toThrow('Failure threshold must be at least 1');
      
      expect(() => new CircuitBreaker({ resetTimeout: -1 }))
        .toThrow('Reset timeout must be positive');
        
      expect(() => new CircuitBreaker({ halfOpenRequests: 0 }))
        .toThrow('Half-open requests must be at least 1');
    });
  });

  describe('success tracking', () => {
    it('should reset failure count on success', async () => {
      // Given: Circuit with some failures
      cb = new CircuitBreaker({ failureThreshold: 3 });
      
      const failingOp = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Failed'));
      const successOp = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      
      // When: Two failures then success
      await expect(cb.execute('test', failingOp)).rejects.toThrow();
      await expect(cb.execute('test', failingOp)).rejects.toThrow();
      expect(await cb.execute('test', successOp)).toBe('success');
      
      // Then: Failure count reset, can fail again without opening
      await expect(cb.execute('test', failingOp)).rejects.toThrow();
      await expect(cb.execute('test', failingOp)).rejects.toThrow();
      expect(cb.getState('test')).toBe('closed'); // Still closed
    });
  });

  describe('error handling', () => {
    it('should handle operation throwing synchronously', async () => {
      // Given: Operation that throws synchronously
      cb = new CircuitBreaker({ failureThreshold: 1 });
      
      const throwingOp = jest.fn(() => {
        throw new Error('Sync error');
      });
      
      // When: Executing operation
      // Then: Should handle as failure
      await expect(cb.execute('test', throwingOp)).rejects.toThrow('Sync error');
      expect(cb.getState('test')).toBe('open');
    });

    it('should pass through operation results unchanged', async () => {
      // Given: Various operation results
      cb = new CircuitBreaker();
      
      // When: Executing operations
      // Then: Results pass through
      expect(await cb.execute('test', () => Promise.resolve('string'))).toBe('string');
      expect(await cb.execute('test', () => Promise.resolve(123))).toBe(123);
      expect(await cb.execute('test', () => Promise.resolve({ a: 1 }))).toEqual({ a: 1 });
      expect(await cb.execute('test', () => Promise.resolve(null))).toBe(null);
    });
  });

  describe('statistics', () => {
    it('should provide circuit statistics', async () => {
      // Given: Circuit with mixed results
      cb = new CircuitBreaker({ failureThreshold: 3 });
      
      const failingOp = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Failed'));
      const successOp = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      
      // When: Mixed operations
      await cb.execute('test', successOp);
      await expect(cb.execute('test', failingOp)).rejects.toThrow();
      await cb.execute('test', successOp);
      
      // Then: Statistics are tracked
      const stats = cb.getStats('test');
      expect(stats.state).toBe('closed');
      expect(stats.failures).toBe(1);
      expect(stats.successes).toBe(2);
      expect(stats.totalRequests).toBe(3);
      expect(stats.lastFailureTime).toEqual(expect.any(Number));
    });

    it('should provide global statistics', () => {
      // Given: Multiple operations
      cb = new CircuitBreaker();
      
      // When: Getting all stats
      const allStats = cb.getAllStats();
      
      // Then: Returns stats for all operations
      expect(allStats).toEqual({});
    });
  });

  describe('cleanup', () => {
    it('should clear all circuits on reset', async () => {
      // Given: Multiple open circuits
      cb = new CircuitBreaker({ failureThreshold: 1 });
      
      const failingOp = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Failed'));
      await expect(cb.execute('op1', failingOp)).rejects.toThrow();
      await expect(cb.execute('op2', failingOp)).rejects.toThrow();
      
      // When: Resetting
      cb.reset();
      
      // Then: All circuits are closed
      expect(cb.getState('op1')).toBe('closed');
      expect(cb.getState('op2')).toBe('closed');
    });

    it('should clear specific circuit', async () => {
      // Given: Multiple circuits
      cb = new CircuitBreaker({ failureThreshold: 1 });
      
      const failingOp = jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Failed'));
      await expect(cb.execute('op1', failingOp)).rejects.toThrow();
      await expect(cb.execute('op2', failingOp)).rejects.toThrow();
      
      // When: Clearing one circuit
      cb.reset('op1');
      
      // Then: Only that circuit is reset
      expect(cb.getState('op1')).toBe('closed');
      expect(cb.getState('op2')).toBe('open');
    });
  });
});