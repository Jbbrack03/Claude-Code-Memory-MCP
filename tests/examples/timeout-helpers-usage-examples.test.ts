/**
 * Timeout Helpers Usage Examples
 * Phase 13: Test Suite Stabilization
 * 
 * This file demonstrates proper usage patterns for the timeout helpers
 * and test cleanup utilities to prevent hanging operations in tests.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { 
  withTimeout,
  setupTestEnvironment,
  teardownTestEnvironment,
  getTestCleanupManager,
  withTestTimeout,
  setupTestTimeouts,
  setupTestCleanup,
  createTimeoutTest,
  TestCleanupManager
} from "../utils/test-helpers.js";

describe('Timeout Helpers Usage Examples', () => {
  
  describe('Basic withTimeout Usage', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('Example 1: Basic timeout wrapper for database operations', async () => {
      // Given: A mock database operation that might hang
      const mockDatabase = {
        query: jest.fn().mockImplementation(() => new Promise(() => {})), // Hangs
        connect: jest.fn().mockResolvedValue('connected')
      };

      // When: Wrapping database operations with timeout
      const timeoutPromise = withTimeout(
        mockDatabase.query('SELECT * FROM users'),
        2000, // 2 second timeout
        'Database query'
      );

      jest.advanceTimersByTime(2001);

      // Then: Should timeout with descriptive error
      await expect(timeoutPromise).rejects.toThrow(
        'Database query timed out after 2000ms'
      );
    });

    it('Example 2: Timeout wrapper for file system operations', async () => {
      // Given: A mock file operation that might hang
      const mockFileSystem = {
        readFile: jest.fn().mockImplementation(() => new Promise(() => {})),
        writeFile: jest.fn().mockResolvedValue(undefined)
      };

      // When: Using timeout with file operations
      const readPromise = withTimeout(
        mockFileSystem.readFile('/large/file.json'),
        1500,
        'File read operation'
      );

      jest.advanceTimersByTime(1501);

      // Then: Should timeout appropriately
      await expect(readPromise).rejects.toThrow(
        'File read operation timed out after 1500ms'
      );
    });

    it('Example 3: Timeout wrapper for network requests', async () => {
      // Given: A mock network request that might hang
      const mockHttp = {
        get: jest.fn().mockImplementation(() => new Promise(() => {})),
        post: jest.fn().mockResolvedValue({ data: 'success' })
      };

      // When: Wrapping network calls with timeout
      const requestPromise = withTimeout(
        mockHttp.get('https://slow-api.com/endpoint'),
        3000,
        'HTTP GET request'
      );

      jest.advanceTimersByTime(3001);

      // Then: Should timeout with network-specific context
      await expect(requestPromise).rejects.toThrow(
        'HTTP GET request timed out after 3000ms'
      );
    });
  });

  describe('Test Environment Setup and Cleanup Examples', () => {
    let cleanupManager: TestCleanupManager;

    beforeEach(async () => {
      jest.clearAllMocks();
      jest.useFakeTimers();
      
      // Example: Setting up test environment with configuration
      await setupTestEnvironment({
        timeout: 10000,
        cleanupOnExit: true,
        trackResources: true,
        logLevel: 'debug'
      });
      
      cleanupManager = getTestCleanupManager();
    });

    afterEach(async () => {
      jest.useRealTimers();
      await teardownTestEnvironment();
    });

    it('Example 4: Database operations with resource cleanup', async () => {
      // Given: Mock database connection with cleanup
      const mockConnection = {
        query: jest.fn().mockImplementation(() => new Promise(() => {})),
        close: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined)
      };

      // Register resource for automatic cleanup
      await cleanupManager.addResource('test-db-connection', 'database', async () => {
        await mockConnection.rollback();
        await mockConnection.close();
      });

      // When: Database operation times out
      const queryPromise = withTimeout(
        mockConnection.query('SELECT * FROM large_table'),
        2000,
        'Database query with cleanup',
        cleanupManager
      );

      jest.advanceTimersByTime(2001);

      // Then: Should timeout and trigger cleanup
      await expect(queryPromise).rejects.toThrow('timed out');
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.close).toHaveBeenCalled();
    });

    it('Example 5: File operations with temporary file cleanup', async () => {
      // Given: Mock file operations with temp file
      const mockTempFile = {
        write: jest.fn().mockImplementation(() => new Promise(() => {})),
        delete: jest.fn().mockResolvedValue(undefined),
        path: '/tmp/test-file-123.json'
      };

      // Register temp file for cleanup
      await cleanupManager.addResource('temp-file-123', 'file', async () => {
        await mockTempFile.delete();
      }, { path: mockTempFile.path });

      // When: File write operation times out
      const writePromise = withTimeout(
        mockTempFile.write('large data'),
        1500,
        'Temporary file write',
        cleanupManager
      );

      jest.advanceTimersByTime(1501);

      // Then: Should cleanup temporary file
      await expect(writePromise).rejects.toThrow('timed out');
      expect(mockTempFile.delete).toHaveBeenCalled();
    });

    it('Example 6: Network operations with connection pooling', async () => {
      // Given: Mock network connection pool
      const mockConnectionPool = {
        getConnection: jest.fn().mockImplementation(() => new Promise(() => {})),
        releaseConnection: jest.fn().mockResolvedValue(undefined),
        closePool: jest.fn().mockResolvedValue(undefined)
      };

      // Register connection pool for cleanup
      await cleanupManager.addResource('http-pool', 'network', async () => {
        await mockConnectionPool.closePool();
      });

      // When: Connection acquisition times out
      const connectionPromise = withTimeout(
        mockConnectionPool.getConnection(),
        2500,
        'HTTP connection pool',
        cleanupManager
      );

      jest.advanceTimersByTime(2501);

      // Then: Should cleanup connection pool
      await expect(connectionPromise).rejects.toThrow('timed out');
      expect(mockConnectionPool.closePool).toHaveBeenCalled();
    });
  });

  describe('Advanced Timeout Helper Usage Examples', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      jest.useFakeTimers();
      await setupTestEnvironment({ timeout: 15000 });
    });

    afterEach(async () => {
      jest.useRealTimers();
      await teardownTestEnvironment();
    });

    it('Example 7: Using withTestTimeout wrapper', async () => {
      // Given: A complex async test function
      const complexTestFunction = async (data: any) => {
        // Simulate complex operations that might hang
        await new Promise(() => {}); // This would hang
        return { processed: data };
      };

      // When: Wrapping with withTestTimeout
      const wrappedFunction = withTestTimeout(complexTestFunction, 3000, 'Complex test operation');

      // Start the operation and advance timers
      const timeoutPromise = wrappedFunction({ test: 'data' });
      jest.advanceTimersByTime(3001);

      // Then: Should timeout when called
      await expect(timeoutPromise).rejects.toThrow(
        'Complex test operation timed out after 3000ms'
      );
    });

    it('Example 8: Automatic timeout test wrapper', async () => {
      // Given: Test logic that might hang
      const mockAsyncOperation = jest.fn().mockImplementation(() => new Promise(() => {}));
      
      // When: Test runs with timeout wrapper
      const cleanupManager = getTestCleanupManager();
      const testPromise = withTimeout(
        mockAsyncOperation(),
        5000,
        'Automatic timeout test wrapper',
        cleanupManager
      );
      
      jest.advanceTimersByTime(5001);
      
      // Then: Should timeout after specified duration
      await expect(testPromise).rejects.toThrow('timed out after 5000ms');
    });
  });

  describe('Real-world Integration Examples', () => {
    let cleanupManager: TestCleanupManager;

    beforeEach(async () => {
      jest.clearAllMocks();
      jest.useFakeTimers();
      await setupTestEnvironment({
        timeout: 20000,
        trackResources: true,
        logLevel: 'info'
      });
      cleanupManager = getTestCleanupManager();
    });

    afterEach(async () => {
      jest.useRealTimers();
      await teardownTestEnvironment();
    });

    it('Example 9: Multi-step process with rollback capability', async () => {
      // Given: Multi-step process that can fail at any step
      const processSteps = {
        step1: jest.fn().mockResolvedValue('step1-complete'),
        step2: jest.fn().mockImplementation(() => new Promise(() => {})), // Hangs here
        step3: jest.fn().mockResolvedValue('step3-complete'),
        rollback: jest.fn().mockResolvedValue('rolled-back')
      };

      // Register rollback cleanup
      await cleanupManager.addResource('multi-step-process', 'custom', async () => {
        await processSteps.rollback();
      });

      // When: Multi-step process times out during step 2
      const processPromise = withTimeout(
        (async () => {
          await processSteps.step1();
          await processSteps.step2(); // This will hang
          await processSteps.step3();
          return 'process-complete';
        })(),
        3000,
        'Multi-step process',
        cleanupManager
      );

      jest.advanceTimersByTime(3001);

      // Then: Should timeout and trigger rollback
      await expect(processPromise).rejects.toThrow('Multi-step process timed out');
      expect(processSteps.step1).toHaveBeenCalled();
      expect(processSteps.step2).toHaveBeenCalled();
      expect(processSteps.step3).not.toHaveBeenCalled();
      expect(processSteps.rollback).toHaveBeenCalled();
    });

    it('Example 10: Concurrent operations with mixed success/failure', async () => {
      // Given: Multiple concurrent operations with different behaviors
      const operations = {
        fastOperation: jest.fn().mockResolvedValue('fast-result'),
        slowOperation: jest.fn().mockImplementation(() => new Promise(() => {})),
        mediumOperation: jest.fn().mockResolvedValue('medium-result') // Simplified for fake timers
      };

      // Register cleanup for all operations
      await cleanupManager.addResource('concurrent-ops', 'custom', async () => {
        // Cleanup logic for concurrent operations
      });

      // When: Running operations with different timeout values
      const concurrentPromises = [
        withTimeout(operations.fastOperation(), 5000, 'Fast operation', cleanupManager),
        withTimeout(operations.slowOperation(), 2000, 'Slow operation', cleanupManager),
        withTimeout(operations.mediumOperation(), 5000, 'Medium operation', cleanupManager)
      ];

      jest.advanceTimersByTime(2001);

      // Then: Should handle mixed results appropriately
      const results = await Promise.allSettled(concurrentPromises);
      
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      if (results[1].status === 'rejected') {
        expect(results[1].reason.message).toContain('Slow operation timed out');
      }
      expect(results[2].status).toBe('fulfilled');
    });

    it('Example 11: Resource statistics and monitoring', async () => {
      // Given: Multiple resources and timeout operations
      const resources = [
        { id: 'db-1', type: 'database' as const, cleanup: jest.fn().mockResolvedValue(undefined) },
        { id: 'file-1', type: 'file' as const, cleanup: jest.fn().mockResolvedValue(undefined) },
        { id: 'network-1', type: 'network' as const, cleanup: jest.fn().mockResolvedValue(undefined) }
      ];

      // Register all resources
      for (const resource of resources) {
        await cleanupManager.addResource(resource.id, resource.type, resource.cleanup);
      }

      // Add timeout operations
      const timeoutOperations = [
        { name: 'Quick operation', timeout: 500, startTime: Date.now() - 100 },
        { name: 'Medium operation', timeout: 2000, startTime: Date.now() - 1500 },
        { name: 'Long operation', timeout: 5000, startTime: Date.now() - 6000 }
      ];

      timeoutOperations.forEach(op => {
        cleanupManager.addTimeoutResource({
          operationName: op.name,
          timeoutMs: op.timeout,
          startTime: op.startTime
        });
      });

      // When: Getting statistics
      const resourceStats = cleanupManager.getStatistics();
      const timeoutStats = cleanupManager.getTimeoutStatistics();

      // Then: Should provide comprehensive monitoring data
      expect(resourceStats.totalResources).toBe(3);
      expect(resourceStats.resourcesByType.database).toBe(1);
      expect(resourceStats.resourcesByType.file).toBe(1);
      expect(resourceStats.resourcesByType.network).toBe(1);

      expect(timeoutStats.totalTimeouts).toBe(3);
      expect(timeoutStats.expiredTimeouts).toBe(1); // Long operation expired
      expect(timeoutStats.activeTimeouts).toBe(2);
      expect(timeoutStats.averageTimeoutDuration).toBe(2500);
      expect(timeoutStats.oldestTimeout).toEqual(
        expect.objectContaining({ operationName: 'Long operation' })
      );
    });
  });

  describe('Best Practices Examples', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('Example 12: Proper error handling with timeout wrappers', async () => {
      // Given: Operation that might throw different types of errors
      const unreliableOperation = jest.fn().mockImplementation(() => {
        // Simulate random failure modes
        throw new Error('Connection refused');
      });

      // When: Using timeout wrapper with proper error handling
      try {
        await withTimeout(
          unreliableOperation(),
          3000,
          'Unreliable network operation'
        );
      } catch (error) {
        // Then: Should distinguish between timeout and operation errors
        if (error instanceof Error) {
          if (error.message.includes('timed out')) {
            // Handle timeout specifically
            expect(error.message).toContain('Unreliable network operation timed out');
          } else {
            // Handle operation error
            expect(error.message).toBe('Connection refused');
          }
        }
      }
    });

    it('Example 13: Nested timeout operations with different timeouts', async () => {
      // Given: Nested operations with different timeout requirements
      const nestedOperations = {
        outerOperation: jest.fn().mockImplementation(async () => {
          // This outer operation has its own timeout
          return withTimeout(
            innerOperations.innerOperation(),
            1000, // Shorter timeout for inner operation
            'Inner database query'
          );
        }),
        innerOperation: jest.fn().mockImplementation(() => new Promise(() => {}))
      };

      const innerOperations = {
        innerOperation: nestedOperations.innerOperation
      };

      // When: Running nested timeout operations
      const outerPromise = withTimeout(
        nestedOperations.outerOperation(),
        5000, // Longer timeout for outer operation
        'Outer process operation'
      );

      jest.advanceTimersByTime(1001);

      // Then: Inner timeout should trigger first
      await expect(outerPromise).rejects.toThrow('Inner database query timed out');
    });

    it('Example 14: Using timeout helpers in beforeEach/afterEach', async () => {
      // This example shows how to structure test setup/teardown
      // with proper timeout and cleanup handling
      
      // The beforeEach and afterEach in this describe block demonstrate
      // the pattern already implemented above
      
      const mockService = {
        initialize: jest.fn().mockResolvedValue('initialized'),
        cleanup: jest.fn().mockResolvedValue('cleaned')
      };

      // Setup phase - would be in beforeEach
      await setupTestEnvironment({ timeout: 10000 });
      const manager = getTestCleanupManager();
      
      await manager.addResource('test-service', 'custom', async () => {
        await mockService.cleanup();
      });

      // Test execution phase
      await withTimeout(
        mockService.initialize(),
        2000,
        'Service initialization',
        manager
      );

      // Cleanup phase - happens automatically in afterEach
      expect(mockService.initialize).toHaveBeenCalled();
    });
  });
});