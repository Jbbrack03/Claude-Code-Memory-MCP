import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { 
  withTimeout,
  setupTestEnvironment,
  teardownTestEnvironment,
  getTestCleanupManager,
  TestCleanupManager
} from "../utils/test-helpers.js";
import "../setup.js";

describe('Timeout Helpers Integration Tests', () => {
  let cleanupManager: TestCleanupManager;
  
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Setup test environment with timeout helpers
    await setupTestEnvironment({
      timeout: 10000,
      cleanupOnExit: true,
      trackResources: true
    });
    
    cleanupManager = getTestCleanupManager();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await teardownTestEnvironment();
  });

  describe('End-to-end timeout scenarios with resource cleanup', () => {
    it('should handle database operation timeout with full cleanup', async () => {
      // Given: Mock database operation that hangs
      const mockDbConnection = {
        query: jest.fn().mockImplementation(() => new Promise(() => {})),
        close: jest.fn().mockResolvedValue(undefined)
      };
      
      // Register database resource for cleanup
      await cleanupManager.addResource('test-db', 'database', async () => {
        await mockDbConnection.close();
      });
      
      // When: Database query times out
      const queryPromise = withTimeout(
        mockDbConnection.query('SELECT * FROM large_table'),
        2000,
        'Database query operation',
        cleanupManager
      );
      
      jest.advanceTimersByTime(2001);
      
      // Then: Should timeout and trigger database cleanup
      await expect(queryPromise).rejects.toThrow(
        'Database query operation timed out after 2000ms'
      );
      
      // Verify force cleanup was triggered
      expect(mockDbConnection.close).toHaveBeenCalled();
    });

    it('should handle file system operation timeout with resource tracking', async () => {
      // Given: Mock file system operation that hangs
      const mockFileHandle = {
        read: jest.fn().mockImplementation(() => new Promise(() => {})),
        close: jest.fn().mockResolvedValue(undefined)
      };
      
      // Register file resource
      await cleanupManager.addResource('temp-file', 'file', async () => {
        await mockFileHandle.close();
      });
      
      // When: File read times out
      const readPromise = withTimeout(
        mockFileHandle.read(),
        1500,
        'File read operation',
        cleanupManager
      );
      
      jest.advanceTimersByTime(1501);
      
      // Then: Should timeout and cleanup file resources
      await expect(readPromise).rejects.toThrow(
        'File read operation timed out after 1500ms'
      );
      expect(mockFileHandle.close).toHaveBeenCalled();
    });

    it('should handle network request timeout with connection cleanup', async () => {
      // Given: Mock network connection that hangs
      const mockNetworkConnection = {
        request: jest.fn().mockImplementation(() => new Promise(() => {})),
        abort: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined)
      };
      
      // Register network resource with custom cleanup
      await cleanupManager.addResource('http-connection', 'network', async () => {
        await mockNetworkConnection.abort();
        await mockNetworkConnection.destroy();
      });
      
      // When: Network request times out
      const requestPromise = withTimeout(
        mockNetworkConnection.request({ url: 'https://slow-api.com/data' }),
        3000,
        'HTTP request',
        cleanupManager
      );
      
      jest.advanceTimersByTime(3001);
      
      // Then: Should timeout and cleanup network resources
      await expect(requestPromise).rejects.toThrow(
        'HTTP request timed out after 3000ms'
      );
      expect(mockNetworkConnection.abort).toHaveBeenCalled();
      expect(mockNetworkConnection.destroy).toHaveBeenCalled();
    });

    it('should handle multiple concurrent timeouts with mixed resource types', async () => {
      // Given: Multiple hanging operations with different resource types
      const mockDb = { close: jest.fn().mockResolvedValue(undefined) };
      const mockFile = { close: jest.fn().mockResolvedValue(undefined) };
      const mockNetwork = { abort: jest.fn().mockResolvedValue(undefined) };
      
      await cleanupManager.addResource('concurrent-db', 'database', () => mockDb.close());
      await cleanupManager.addResource('concurrent-file', 'file', () => mockFile.close());
      await cleanupManager.addResource('concurrent-network', 'network', () => mockNetwork.abort());
      
      const operations = [
        withTimeout(new Promise(() => {}), 1000, 'Concurrent DB operation', cleanupManager),
        withTimeout(new Promise(() => {}), 1200, 'Concurrent file operation', cleanupManager),
        withTimeout(new Promise(() => {}), 800, 'Concurrent network operation', cleanupManager)
      ];
      
      // When: All operations timeout at different times
      jest.advanceTimersByTime(801);
      jest.advanceTimersByTime(200); // Total: 1001ms
      jest.advanceTimersByTime(200); // Total: 1201ms
      
      // Then: Should handle all timeouts and cleanups
      const results = await Promise.allSettled(operations);
      
      results.forEach((result, index) => {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason.message).toContain('timed out');
        }
      });
      
      // All cleanup functions should have been called
      expect(mockDb.close).toHaveBeenCalled();
      expect(mockFile.close).toHaveBeenCalled();
      expect(mockNetwork.abort).toHaveBeenCalled();
    });

    it('should handle timeout resource lifecycle from creation to cleanup', async () => {
      // Given: Complex operation with multiple stages
      const stages = {
        connect: jest.fn().mockResolvedValue('connected'),
        authenticate: jest.fn().mockImplementation(() => new Promise(() => {})), // Hangs here
        query: jest.fn().mockResolvedValue('data'),
        cleanup: jest.fn().mockResolvedValue(undefined)
      };
      
      await cleanupManager.addResource('complex-operation', 'database', stages.cleanup);
      
      // When: Multi-stage operation where authentication hangs
      const complexOperation = async () => {
        await stages.connect();
        await stages.authenticate(); // This will hang
        await stages.query();
        return 'success';
      };
      
      const operationPromise = withTimeout(
        complexOperation(),
        2500,
        'Complex multi-stage operation',
        cleanupManager
      );
      
      jest.advanceTimersByTime(2501);
      
      // Then: Should timeout during authentication stage
      await expect(operationPromise).rejects.toThrow(
        'Complex multi-stage operation timed out after 2500ms'
      );
      
      // Should have called connect but not query
      expect(stages.connect).toHaveBeenCalled();
      expect(stages.authenticate).toHaveBeenCalled();
      expect(stages.query).not.toHaveBeenCalled();
      expect(stages.cleanup).toHaveBeenCalled();
    });
  });

  describe('Resource cleanup integration with Jest lifecycle', () => {
    it('should integrate timeout tracking with test setup/teardown', async () => {
      // Given: Test that uses timeout operations
      const testOperation = jest.fn().mockImplementation(() => new Promise(() => {}));
      
      // When: Using timeout within test lifecycle
      const timeoutPromise = withTimeout(
        testOperation(),
        1000,
        'Test lifecycle operation',
        cleanupManager
      );
      
      // Simulate test timeout
      jest.advanceTimersByTime(1001);
      
      // Then: Should be tracked and cleaned up during teardown
      await expect(timeoutPromise).rejects.toThrow('Test lifecycle operation timed out');
      
      // When: Test teardown occurs
      await teardownTestEnvironment();
      
      // Then: All timeout resources should be cleaned up
      expect(cleanupManager.getTimeoutResources()).toHaveLength(0);
    });

    it('should handle test environment cleanup when timeouts are still active', async () => {
      // Given: Active timeout operations
      const longRunningOp = new Promise(() => {}); // Never resolves
      
      const timeoutPromise = withTimeout(
        longRunningOp,
        10000, // Long timeout
        'Long running test operation',
        cleanupManager
      );
      
      // When: Test environment teardown occurs before timeout
      await teardownTestEnvironment();
      
      // Then: Should force cleanup of active timeouts
      expect(cleanupManager.getAllResources()).toHaveLength(0);
      
      // Promise should eventually be rejected
      jest.advanceTimersByTime(10001);
      await expect(timeoutPromise).rejects.toThrow();
    });

    it('should provide timeout statistics and diagnostics', () => {
      // Given: Multiple timeout operations with different characteristics
      const timeoutResources = [
        { operationName: 'Fast operation', timeoutMs: 500, startTime: Date.now() - 100 },
        { operationName: 'Medium operation', timeoutMs: 2000, startTime: Date.now() - 1500 },
        { operationName: 'Slow operation', timeoutMs: 5000, startTime: Date.now() - 6000 }
      ];
      
      timeoutResources.forEach(resource => {
        cleanupManager.addTimeoutResource(resource);
      });
      
      // When: Getting timeout statistics
      const stats = cleanupManager.getTimeoutStatistics();
      
      // Then: Should provide comprehensive statistics
      expect(stats.totalTimeouts).toBe(3);
      expect(stats.expiredTimeouts).toBe(1); // Slow operation expired
      expect(stats.activeTimeouts).toBe(2);
      expect(stats.averageTimeoutDuration).toBe(2500);
      expect(stats.oldestTimeout).toEqual(expect.objectContaining({
        operationName: 'Slow operation'
      }));
    });
  });

  describe('Error handling and edge cases in integration', () => {
    it('should handle cleanup manager failures during timeout', async () => {
      // Given: Cleanup manager that fails during force cleanup
      const failingCleanupManager = {
        addTimeoutResource: jest.fn(),
        forceCleanup: jest.fn().mockRejectedValue(new Error('Cleanup manager failed')),
        isResourceTracked: jest.fn().mockReturnValue(true)
      };
      
      const hangingPromise = new Promise(() => {});
      
      // When: Timeout occurs with failing cleanup manager
      const timeoutPromise = withTimeout(
        hangingPromise,
        1000,
        'Operation with failing cleanup',
        failingCleanupManager
      );
      
      jest.advanceTimersByTime(1001);
      
      // Then: Should still timeout despite cleanup failure
      await expect(timeoutPromise).rejects.toThrow(
        'Operation with failing cleanup timed out after 1000ms'
      );
      
      expect(failingCleanupManager.forceCleanup).toHaveBeenCalled();
    });

    it('should handle memory pressure during timeout operations', async () => {
      // Given: Many concurrent timeout operations (memory pressure simulation)
      const operations = Array.from({ length: 1000 }, (_, i) => 
        withTimeout(
          new Promise(() => {}),
          1000 + i,
          `Memory pressure operation ${i}`,
          cleanupManager
        )
      );
      
      // When: All operations are active simultaneously
      jest.advanceTimersByTime(2001); // Timeout all operations
      
      // Then: Should handle memory pressure gracefully
      const results = await Promise.allSettled(operations);
      expect(results.every(r => r.status === 'rejected')).toBe(true);
      
      // Memory should be cleaned up
      expect(cleanupManager.getTimeoutResources()).toHaveLength(0);
    });

    it('should handle system resource exhaustion scenarios', async () => {
      // Given: Mock system resource exhaustion
      const mockSystemCall = jest.fn().mockImplementation(() => {
        const error = new Error('EMFILE: too many open files');
        (error as any).code = 'EMFILE';
        return Promise.reject(error);
      });
      
      await cleanupManager.addResource('system-resource', 'file', async () => {
        await mockSystemCall();
      });
      
      // When: Timeout triggers cleanup during resource exhaustion
      const timeoutPromise = withTimeout(
        new Promise(() => {}),
        1000,
        'System resource operation',
        cleanupManager
      );
      
      jest.advanceTimersByTime(1001);
      
      // Then: Should handle system errors gracefully
      await expect(timeoutPromise).rejects.toThrow(
        'System resource operation timed out after 1000ms'
      );
      
      // System error should be handled during cleanup
      expect(mockSystemCall).toHaveBeenCalled();
    });

    it('should handle circular dependencies in resource cleanup', async () => {
      // Given: Resources with circular dependencies
      const resourceA = { 
        cleanup: jest.fn().mockImplementation(async () => {
          await cleanupManager.cleanupResource('resource-b');
        })
      };
      
      const resourceB = {
        cleanup: jest.fn().mockImplementation(async () => {
          await cleanupManager.cleanupResource('resource-a');
        })
      };
      
      await cleanupManager.addResource('resource-a', 'custom', resourceA.cleanup);
      await cleanupManager.addResource('resource-b', 'custom', resourceB.cleanup);
      
      // When: Timeout triggers cleanup with circular dependencies
      const timeoutPromise = withTimeout(
        new Promise(() => {}),
        1000,
        'Circular dependency operation',
        cleanupManager
      );
      
      jest.advanceTimersByTime(1001);
      
      // Then: Should detect and handle circular dependencies
      await expect(timeoutPromise).rejects.toThrow('timed out');
      
      // Should not cause infinite recursion
      expect(resourceA.cleanup).toHaveBeenCalled();
      expect(resourceB.cleanup).toHaveBeenCalled();
    });
  });

  describe('Performance and scalability integration tests', () => {
    it('should handle high-frequency timeout operations efficiently', async () => {
      jest.useRealTimers(); // Use real timers for performance testing
      
      // Given: High frequency timeout operations
      const startTime = Date.now();
      const operations = Array.from({ length: 100 }, (_, i) =>
        withTimeout(
          Promise.resolve(`result-${i}`),
          1000,
          `High frequency operation ${i}`,
          cleanupManager
        )
      );
      
      // When: Executing all operations
      const results = await Promise.all(operations);
      const endTime = Date.now();
      
      // Then: Should complete efficiently
      expect(results).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(1000); // Should be much faster
      
      results.forEach((result, i) => {
        expect(result).toBe(`result-${i}`);
      });
      
      jest.useFakeTimers();
    });

    it('should scale cleanup operations with large resource counts', async () => {
      // Given: Large number of resources
      const cleanupFunctions = Array.from({ length: 500 }, (_, i) =>
        jest.fn().mockResolvedValue(`cleaned-${i}`)
      );
      
      // Register all resources
      await Promise.all(
        cleanupFunctions.map((fn, i) =>
          cleanupManager.addResource(`scale-resource-${i}`, 'custom', fn)
        )
      );
      
      // When: Performing bulk cleanup
      const startTime = Date.now();
      await cleanupManager.cleanup();
      const endTime = Date.now();
      
      // Then: Should scale efficiently
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
      
      // All cleanup functions should have been called
      cleanupFunctions.forEach(fn => {
        expect(fn).toHaveBeenCalled();
      });
      
      expect(cleanupManager.getAllResources()).toHaveLength(0);
    });

    it('should maintain performance under concurrent timeout and cleanup operations', async () => {
      // Given: Concurrent timeout and cleanup operations
      const timeoutOperations = Array.from({ length: 50 }, (_, i) =>
        withTimeout(
          new Promise(resolve => setTimeout(resolve, 100)),
          500,
          `Concurrent timeout ${i}`,
          cleanupManager
        )
      );
      
      const cleanupOperations = Array.from({ length: 50 }, async (_, i) => {
        await cleanupManager.addResource(`concurrent-${i}`, 'custom', async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        });
        return cleanupManager.cleanupResource(`concurrent-${i}`);
      });
      
      // When: Running operations concurrently
      const startTime = Date.now();
      await Promise.all([...timeoutOperations, ...cleanupOperations]);
      const endTime = Date.now();
      
      // Then: Should maintain reasonable performance
      expect(endTime - startTime).toBeLessThan(10000); // Within 10 seconds
    });
  });
});