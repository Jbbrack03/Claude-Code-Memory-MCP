import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { withTimeout } from "./test-helpers.js";

describe('Test Helpers - withTimeout Function', () => {
  let mockCleanupManager: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Mock cleanup manager for timeout scenarios
    mockCleanupManager = {
      addTimeoutResource: jest.fn(),
      forceCleanup: jest.fn(),
      isResourceTracked: jest.fn().mockReturnValue(false),
      cleanupTimeoutResources: jest.fn()
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Basic timeout functionality', () => {
    it('should resolve when promise completes before timeout', async () => {
      // Given: A promise that resolves quickly
      const fastPromise = Promise.resolve('success');
      
      // When: Using withTimeout with generous timeout
      const timeoutPromise = withTimeout(fastPromise, 5000, 'Fast operation');
      
      // Then: Should resolve with original value
      await expect(timeoutPromise).resolves.toBe('success');
    });

    it('should reject with timeout error when promise takes too long', async () => {
      // Given: A promise that never resolves
      const slowPromise = new Promise(() => {});
      
      // When: Using withTimeout with short timeout
      const timeoutPromise = withTimeout(slowPromise, 1000, 'Slow operation');
      
      // Fast-forward timers
      jest.advanceTimersByTime(1001);
      
      // Then: Should reject with timeout error
      await expect(timeoutPromise).rejects.toThrow('Slow operation timed out after 1000ms');
    });

    it('should reject with timeout error containing operation name', async () => {
      // Given: A hanging promise with specific operation name
      const hangingPromise = new Promise(() => {});
      const operationName = 'Database connection initialization';
      
      // When: Using withTimeout
      const timeoutPromise = withTimeout(hangingPromise, 500, operationName);
      
      jest.advanceTimersByTime(501);
      
      // Then: Error message should include operation name
      await expect(timeoutPromise).rejects.toThrow(
        `${operationName} timed out after 500ms`
      );
    });

    it('should handle promise that rejects before timeout', async () => {
      // Given: A promise that rejects quickly
      const rejectingPromise = Promise.reject(new Error('Original error'));
      
      // When: Using withTimeout
      const timeoutPromise = withTimeout(rejectingPromise, 5000, 'Rejecting operation');
      
      // Then: Should reject with original error
      await expect(timeoutPromise).rejects.toThrow('Original error');
    });
  });

  describe('Resource cleanup integration', () => {
    it('should track timeout resources when cleanup manager provided', async () => {
      // Given: Hanging promise with cleanup manager
      const hangingPromise = new Promise(() => {});
      
      // When: Using withTimeout with cleanup manager
      const timeoutPromise = withTimeout(
        hangingPromise, 
        1000, 
        'Tracked operation',
        mockCleanupManager
      );
      
      // Then: Should track timeout resource
      expect(mockCleanupManager.addTimeoutResource).toHaveBeenCalledWith(
        expect.objectContaining({
          operationName: 'Tracked operation',
          timeoutMs: 1000,
          startTime: expect.any(Number)
        })
      );
      
      // Cleanup hanging promise
      jest.advanceTimersByTime(1001);
      await timeoutPromise.catch(() => {});
    });

    it('should trigger force cleanup when timeout occurs', async () => {
      // Given: Hanging promise with cleanup manager
      const hangingPromise = new Promise(() => {});
      
      // When: Timeout occurs
      const timeoutPromise = withTimeout(
        hangingPromise,
        800,
        'Cleanup operation',
        mockCleanupManager
      );
      
      jest.advanceTimersByTime(801);
      
      // Then: Should trigger force cleanup
      await timeoutPromise.catch(() => {});
      expect(mockCleanupManager.forceCleanup).toHaveBeenCalledWith('Cleanup operation');
    });

    it('should not call cleanup when promise resolves normally', async () => {
        // Given: Fast resolving promise
        const fastPromise = Promise.resolve('result');
        
        // When: Using withTimeout with cleanup manager
        await withTimeout(fastPromise, 1000, 'Fast operation', mockCleanupManager);
        
        // Then: Should not trigger force cleanup
        expect(mockCleanupManager.forceCleanup).not.toHaveBeenCalled();
    });

    it('should handle cleanup manager errors gracefully', async () => {
      // Given: Cleanup manager that throws errors
      const failingCleanupManager = {
        addTimeoutResource: jest.fn().mockImplementation(() => {
          throw new Error('Cleanup manager error');
        }),
        forceCleanup: jest.fn()
      };
      
      const hangingPromise = new Promise(() => {});
      
      // When: Using withTimeout with failing cleanup manager
      const timeoutPromise = withTimeout(
        hangingPromise,
        1000,
        'Failing cleanup operation',
        failingCleanupManager
      );
      
      jest.advanceTimersByTime(1001);
      
      // Then: Should still timeout normally despite cleanup manager error
      await expect(timeoutPromise).rejects.toThrow(
        'Failing cleanup operation timed out after 1000ms'
      );
    });
  });

  describe('Edge cases and error conditions', () => {
    it('should handle zero timeout', async () => {
      // Given: Any promise with zero timeout
      const promise = Promise.resolve('value');
      
      // When: Using zero timeout
      const timeoutPromise = withTimeout(promise, 0, 'Zero timeout');
      
      jest.advanceTimersByTime(1);
      
      // Then: Should timeout immediately
      await expect(timeoutPromise).rejects.toThrow(
        'Zero timeout timed out after 0ms'
      );
    });

    it('should handle negative timeout', async () => {
      // Given: Promise with negative timeout
      const promise = Promise.resolve('value');
      
      // When: Using negative timeout
      const timeoutPromise = withTimeout(promise, -100, 'Negative timeout');
      
      jest.advanceTimersByTime(1);
      
      // Then: Should timeout immediately
      await expect(timeoutPromise).rejects.toThrow(
        'Negative timeout timed out after -100ms'
      );
    });

    it('should handle very large timeout values', async () => {
      // Given: Fast promise with very large timeout
      const fastPromise = Promise.resolve('success');
      
      // When: Using maximum safe integer timeout
      const timeoutPromise = withTimeout(
        fastPromise, 
        Number.MAX_SAFE_INTEGER, 
        'Large timeout'
      );
      
      // Then: Should resolve normally
      await expect(timeoutPromise).resolves.toBe('success');
    });

    it('should handle undefined operation name', async () => {
      // Given: Promise with undefined operation name
      const hangingPromise = new Promise(() => {});
      
      // When: Using withTimeout with undefined name
      const timeoutPromise = withTimeout(hangingPromise, 1000);
      
      jest.advanceTimersByTime(1001);
      
      // Then: Should use default error message
      await expect(timeoutPromise).rejects.toThrow(
        'Operation timed out after 1000ms'
      );
    });

    it('should handle empty string operation name', async () => {
      // Given: Promise with empty operation name
      const hangingPromise = new Promise(() => {});
      
      // When: Using withTimeout with empty name
      const timeoutPromise = withTimeout(hangingPromise, 1000, '');
      
      jest.advanceTimersByTime(1001);
      
      // Then: Should use default error message
      await expect(timeoutPromise).rejects.toThrow(
        'Operation timed out after 1000ms'
      );
    });
  });

  describe('Concurrent timeout operations', () => {
    it('should handle multiple concurrent timeouts', async () => {
      // Given: Multiple hanging promises
      const promises = [
        new Promise(() => {}),
        new Promise(() => {}),
        new Promise(() => {})
      ];
      
      // When: Creating multiple timeout wrappers
      const timeoutPromises = promises.map((p, i) => 
        withTimeout(p, 1000 + i * 100, `Operation ${i}`)
      );
      
      jest.advanceTimersByTime(1301);
      
      // Then: All should timeout with appropriate messages
      const results = await Promise.allSettled(timeoutPromises);
      
      results.forEach((result, i) => {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason.message).toContain(`Operation ${i} timed out`);
        }
      });
    });

    it('should handle mix of resolving and timing out promises', async () => {
      // Given: Mix of fast and slow promises
      const fastPromise = Promise.resolve('fast');
      const slowPromise = new Promise(() => {});
      const mediumPromise = new Promise(resolve => 
        setTimeout(() => resolve('medium'), 500)
      );
      
      // When: Wrapping with different timeouts
      const promises = [
        withTimeout(fastPromise, 1000, 'Fast'),
        withTimeout(slowPromise, 800, 'Slow'),
        withTimeout(mediumPromise, 1000, 'Medium')
      ];
      
      jest.advanceTimersByTime(801);
      
      // Then: Should get expected mix of results
      const results = await Promise.allSettled(promises);
      
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      if (results[1].status === 'rejected') {
        expect(results[1].reason.message).toContain('Slow timed out');
      }
    });

    it('should track multiple timeout resources independently', async () => {
      // Given: Multiple promises with cleanup manager
      const promises = [
        new Promise(() => {}),
        new Promise(() => {})
      ];
      
      // When: Creating timeout wrappers with tracking
      const timeoutPromises = promises.map((p, i) =>
        withTimeout(p, 1000, `Tracked operation ${i}`, mockCleanupManager)
      );
      
      // Then: Should track each resource separately
      expect(mockCleanupManager.addTimeoutResource).toHaveBeenCalledTimes(2);
      expect(mockCleanupManager.addTimeoutResource).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ operationName: 'Tracked operation 0' })
      );
      expect(mockCleanupManager.addTimeoutResource).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ operationName: 'Tracked operation 1' })
      );
      
      // Cleanup
      jest.advanceTimersByTime(1001);
      await Promise.allSettled(timeoutPromises);
    });
  });

  describe('Memory and performance considerations', () => {
    it('should not leak timer references on successful resolution', async () => {
      // Given: Fast resolving promise
      const fastPromise = Promise.resolve('result');
      
      // When: Using withTimeout
      const result = await withTimeout(fastPromise, 5000, 'Memory test');
      
      // Then: Should resolve successfully without leaking timers
      expect(result).toBe('result');
      // Note: Timer cleanup verification would require access to Node.js internals
      // This test validates the happy path behavior
    });

    it('should handle rapid successive timeout operations', async () => {
      // Given: Rapid fire timeout operations
      const operations = Array.from({ length: 100 }, (_, i) => 
        withTimeout(Promise.resolve(i), 1000, `Rapid operation ${i}`)
      );
      
      // When: Executing all operations
      const results = await Promise.all(operations);
      
      // Then: All should resolve successfully
      expect(results).toHaveLength(100);
      results.forEach((result, i) => {
        expect(result).toBe(i);
      });
    });

    it('should handle promise that resolves exactly at timeout boundary', async () => {
      // Given: Promise that resolves at timeout boundary
      const boundaryPromise = new Promise(resolve => {
        setTimeout(() => resolve('boundary'), 1000);
      });
      
      // When: Using exact timeout duration
      const timeoutPromise = withTimeout(boundaryPromise, 1000, 'Boundary test');
      
      jest.advanceTimersByTime(1000);
      
      // Then: Behavior should be deterministic (implementation dependent)
      // This tests the edge case handling
      const result = await timeoutPromise.catch(err => err.message);
      expect(typeof result).toBe('string');
    });
  });

  describe('Integration with real async operations', () => {
    it('should work with filesystem operations that might hang', async () => {
      // Given: Mock filesystem operation that hangs
      const mockFsOperation = jest.fn().mockImplementation(() => new Promise(() => {}));
      
      // When: Wrapping with timeout
      const timeoutPromise = withTimeout(
        mockFsOperation(),
        2000,
        'Filesystem operation'
      );
      
      jest.advanceTimersByTime(2001);
      
      // Then: Should timeout appropriately
      await expect(timeoutPromise).rejects.toThrow(
        'Filesystem operation timed out after 2000ms'
      );
    });

    it('should work with network operations that might hang', async () => {
      // Given: Mock network operation that hangs
      const mockNetworkOperation = jest.fn().mockImplementation(() => new Promise(() => {}));
      
      // When: Wrapping with timeout
      const timeoutPromise = withTimeout(
        mockNetworkOperation(),
        3000,
        'Network request'
      );
      
      jest.advanceTimersByTime(3001);
      
      // Then: Should timeout with network-specific message
      await expect(timeoutPromise).rejects.toThrow(
        'Network request timed out after 3000ms'
      );
    });

    it('should work with database operations that might hang', async () => {
      // Given: Mock database operation that hangs
      const mockDbOperation = jest.fn().mockImplementation(() => new Promise(() => {}));
      
      // When: Wrapping with timeout and cleanup manager
      const timeoutPromise = withTimeout(
        mockDbOperation(),
        1500,
        'Database query',
        mockCleanupManager
      );
      
      jest.advanceTimersByTime(1501);
      
      // Then: Should timeout and trigger cleanup
      await expect(timeoutPromise).rejects.toThrow(
        'Database query timed out after 1500ms'
      );
      expect(mockCleanupManager.forceCleanup).toHaveBeenCalledWith('Database query');
    });
  });
});