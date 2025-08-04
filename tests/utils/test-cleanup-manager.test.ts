import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { 
  TestCleanupManager,
  ResourceType,
  CleanupResource,
  CleanupOptions,
  ResourceLifecycleHooks
} from "./test-cleanup-manager.js";

describe('Test Cleanup Manager - Resource Lifecycle Tracking', () => {
  let cleanupManager: TestCleanupManager;
  let mockHooks: ResourceLifecycleHooks;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    mockHooks = {
      onResourceCreated: jest.fn(),
      onResourceCleaned: jest.fn(),
      onResourceFailed: jest.fn(),
      onForceCleanup: jest.fn()
    };
    
    cleanupManager = new TestCleanupManager({
      defaultTimeout: 5000,
      enableLogging: false,
      hooks: mockHooks
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await cleanupManager.cleanup().catch(() => {});
  });

  describe('Basic resource management', () => {
    it('should track resources when added', async () => {
      // Given: Empty cleanup manager
      expect(cleanupManager.getAllResources()).toHaveLength(0);
      
      // When: Adding resources
      await cleanupManager.addResource('test-db', 'database', async () => {});
      await cleanupManager.addResource('temp-file', 'file', async () => {});
      
      // Then: Should track all resources
      const resources = cleanupManager.getAllResources();
      expect(resources).toHaveLength(2);
      expect(resources.map(r => r.id)).toContain('test-db');
      expect(resources.map(r => r.id)).toContain('temp-file');
    });

    it('should call lifecycle hooks when resources are added', async () => {
      // Given: Cleanup manager with hooks
      const cleanupFn = jest.fn();
      
      // When: Adding resource
      await cleanupManager.addResource('hook-test', 'database', cleanupFn);
      
      // Then: Should call onCreate hook
      expect(mockHooks.onResourceCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'hook-test',
          type: 'database',
          cleanupFn
        })
      );
    });

    it('should prevent duplicate resource IDs', async () => {
      // Given: Existing resource
      await cleanupManager.addResource('duplicate-id', 'database', async () => {});
      
      // When: Adding resource with same ID
      const duplicatePromise = cleanupManager.addResource('duplicate-id', 'file', async () => {});
      
      // Then: Should reject duplicate
      await expect(duplicatePromise).rejects.toThrow('Resource with ID duplicate-id already exists');
    });

    it('should retrieve resources by ID', async () => {
      // Given: Added resource
      const cleanupFn = jest.fn();
      await cleanupManager.addResource('retrievable', 'network', cleanupFn);
      
      // When: Retrieving resource
      const resource = cleanupManager.getResource('retrievable');
      
      // Then: Should return correct resource
      expect(resource).toEqual(expect.objectContaining({
        id: 'retrievable',
        type: 'network',
        cleanupFn
      }));
    });

    it('should return undefined for non-existent resources', () => {
      // Given: Empty cleanup manager
      
      // When: Retrieving non-existent resource
      const resource = cleanupManager.getResource('non-existent');
      
      // Then: Should return undefined
      expect(resource).toBeUndefined();
    });

    it('should filter resources by type', async () => {
      // Given: Mixed resource types
      await cleanupManager.addResource('db1', 'database', async () => {});
      await cleanupManager.addResource('db2', 'database', async () => {});
      await cleanupManager.addResource('file1', 'file', async () => {});
      await cleanupManager.addResource('net1', 'network', async () => {});
      
      // When: Getting resources by type
      const dbResources = cleanupManager.getResourcesByType('database');
      
      // Then: Should return only database resources
      expect(dbResources).toHaveLength(2);
      expect(dbResources.every(r => r.type === 'database')).toBe(true);
    });
  });

  describe('Resource cleanup operations', () => {
    it('should cleanup individual resources', async () => {
      // Given: Resource with cleanup function
      const cleanupFn = jest.fn().mockResolvedValue(undefined);
      await cleanupManager.addResource('cleanable', 'database', cleanupFn);
      
      // When: Cleaning up resource
      await cleanupManager.cleanupResource('cleanable');
      
      // Then: Should call cleanup function and remove resource
      expect(cleanupFn).toHaveBeenCalled();
      expect(cleanupManager.getResource('cleanable')).toBeUndefined();
      expect(mockHooks.onResourceCleaned).toHaveBeenCalledWith('cleanable');
    });

    it('should handle cleanup function errors', async () => {
      // Given: Resource with failing cleanup
      const failingCleanup = jest.fn().mockRejectedValue(new Error('Cleanup failed'));
      await cleanupManager.addResource('failing', 'database', failingCleanup);
      
      // When: Attempting cleanup
      await expect(cleanupManager.cleanupResource('failing')).rejects.toThrow('Cleanup failed');
      
      // Then: Should call failure hook but keep resource tracked
      expect(mockHooks.onResourceFailed).toHaveBeenCalledWith(
        'failing',
        expect.any(Error)
      );
      expect(cleanupManager.getResource('failing')).toBeDefined();
    });

    it('should cleanup resources by type', async () => {
      // Given: Mixed resource types
      const dbCleanup1 = jest.fn().mockResolvedValue(undefined);
      const dbCleanup2 = jest.fn().mockResolvedValue(undefined);
      const fileCleanup = jest.fn().mockResolvedValue(undefined);
      
      await cleanupManager.addResource('db1', 'database', dbCleanup1);
      await cleanupManager.addResource('db2', 'database', dbCleanup2);
      await cleanupManager.addResource('file1', 'file', fileCleanup);
      
      // When: Cleaning up database resources
      await cleanupManager.cleanupByType('database');
      
      // Then: Should cleanup only database resources
      expect(dbCleanup1).toHaveBeenCalled();
      expect(dbCleanup2).toHaveBeenCalled();
      expect(fileCleanup).not.toHaveBeenCalled();
      
      const remainingResources = cleanupManager.getAllResources();
      expect(remainingResources).toHaveLength(1);
      expect(remainingResources[0].type).toBe('file');
    });

    it('should cleanup all resources', async () => {
      // Given: Multiple resources
      const cleanups = [
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue(undefined)
      ];
      
      await cleanupManager.addResource('res1', 'database', cleanups[0]);
      await cleanupManager.addResource('res2', 'file', cleanups[1]);
      await cleanupManager.addResource('res3', 'network', cleanups[2]);
      
      // When: Cleaning up all resources
      await cleanupManager.cleanup();
      
      // Then: Should cleanup all resources
      cleanups.forEach(cleanup => {
        expect(cleanup).toHaveBeenCalled();
      });
      expect(cleanupManager.getAllResources()).toHaveLength(0);
    });

    it('should handle mixed success/failure during bulk cleanup', async () => {
      // Given: Resources with mixed cleanup behavior
      const successCleanup = jest.fn().mockResolvedValue(undefined);
      const failingCleanup = jest.fn().mockRejectedValue(new Error('Failed'));
      
      await cleanupManager.addResource('success', 'database', successCleanup);
      await cleanupManager.addResource('failure', 'database', failingCleanup);
      
      // When: Cleaning up by type
      const results = await cleanupManager.cleanupByType('database');
      
      // Then: Should return mixed results
      expect(results.successful).toContain('success');
      expect(results.failed).toHaveLength(1);
      expect(results.failed[0].id).toBe('failure');
      
      // Should remove successful resource but keep failed one
      expect(cleanupManager.getResource('success')).toBeUndefined();
      expect(cleanupManager.getResource('failure')).toBeDefined();
    });
  });

  describe('Timeout resource tracking', () => {
    it('should track timeout operations', () => {
      // Given: Timeout resource details
      const timeoutResource = {
        operationName: 'Database query',
        timeoutMs: 5000,
        startTime: Date.now()
      };
      
      // When: Adding timeout resource
      cleanupManager.addTimeoutResource(timeoutResource);
      
      // Then: Should track timeout resource
      const timeoutResources = cleanupManager.getTimeoutResources();
      expect(timeoutResources).toHaveLength(1);
      expect(timeoutResources[0]).toEqual(expect.objectContaining(timeoutResource));
    });

    it('should detect expired timeout operations', () => {
      // Given: Timeout resource from the past
      const expiredResource = {
        operationName: 'Expired operation',
        timeoutMs: 1000,
        startTime: Date.now() - 2000 // 2 seconds ago
      };
      
      cleanupManager.addTimeoutResource(expiredResource);
      
      // When: Checking for expired timeouts
      const expiredResources = cleanupManager.getExpiredTimeouts();
      
      // Then: Should identify expired resource
      expect(expiredResources).toHaveLength(1);
      expect(expiredResources[0].operationName).toBe('Expired operation');
    });

    it('should force cleanup on timeout', async () => {
      // Given: Resources and timeout scenario
      const cleanupFn = jest.fn().mockResolvedValue(undefined);
      await cleanupManager.addResource('timeout-resource', 'database', cleanupFn);
      
      // When: Force cleanup is triggered
      await cleanupManager.forceCleanup('Database operation timeout');
      
      // Then: Should trigger force cleanup hook and cleanup resources
      expect(mockHooks.onForceCleanup).toHaveBeenCalledWith('Database operation timeout');
      expect(cleanupFn).toHaveBeenCalled();
    });

    it('should clean up timeout resources after completion', () => {
      // Given: Multiple timeout resources
      const timeoutResources = [
        { operationName: 'Op1', timeoutMs: 1000, startTime: Date.now() },
        { operationName: 'Op2', timeoutMs: 2000, startTime: Date.now() - 3000 },
        { operationName: 'Op3', timeoutMs: 1500, startTime: Date.now() }
      ];
      
      timeoutResources.forEach(resource => {
        cleanupManager.addTimeoutResource(resource);
      });
      
      // When: Cleaning up expired timeout resources
      cleanupManager.cleanupTimeoutResources();
      
      // Then: Should remove expired resources
      const remainingResources = cleanupManager.getTimeoutResources();
      expect(remainingResources).toHaveLength(2); // Op1 and Op3 should remain
      expect(remainingResources.map(r => r.operationName)).not.toContain('Op2');
    });
  });

  describe('Resource lifecycle and metadata', () => {
    it('should track resource creation timestamps', async () => {
      // Given: Current time
      const beforeCreation = Date.now();
      
      // When: Creating resource
      await cleanupManager.addResource('timestamped', 'database', async () => {});
      
      const afterCreation = Date.now();
      const resource = cleanupManager.getResource('timestamped');
      
      // Then: Should have creation timestamp
      expect(resource?.createdAt).toBeGreaterThanOrEqual(beforeCreation);
      expect(resource?.createdAt).toBeLessThanOrEqual(afterCreation);
    });

    it('should track resource cleanup attempts', async () => {
      // Given: Resource with cleanup function
      const cleanupFn = jest.fn().mockResolvedValue(undefined);
      await cleanupManager.addResource('tracked', 'database', cleanupFn);
      
      // When: Attempting cleanup multiple times
      await cleanupManager.cleanupResource('tracked').catch(() => {});
      
      // Then: Should track cleanup attempts
      // Note: Since successful cleanup removes resource, we test the tracking mechanism
      expect(mockHooks.onResourceCleaned).toHaveBeenCalledWith('tracked');
    });

    it('should provide resource statistics', async () => {
      // Given: Various resources
      await cleanupManager.addResource('db1', 'database', async () => {});
      await cleanupManager.addResource('db2', 'database', async () => {});
      await cleanupManager.addResource('file1', 'file', async () => {});
      
      // When: Getting statistics
      const stats = cleanupManager.getStatistics();
      
      // Then: Should provide accurate statistics
      expect(stats.totalResources).toBe(3);
      expect(stats.resourcesByType).toEqual({
        database: 2,
        file: 1,
        network: 0,
        memory: 0,
        custom: 0
      });
    });

    it('should track resource metadata', async () => {
      // Given: Resource with metadata
      const metadata = {
        connectionString: 'postgres://test',
        poolSize: 10,
        tags: ['integration-test', 'database']
      };
      
      // When: Adding resource with metadata
      await cleanupManager.addResource('metadata-resource', 'database', async () => {}, metadata);
      
      const resource = cleanupManager.getResource('metadata-resource');
      
      // Then: Should store metadata
      expect(resource?.metadata).toEqual(metadata);
    });

    it('should handle resource dependencies', async () => {
      // Given: Resources with dependencies
      await cleanupManager.addResource('dependency', 'database', async () => {});
      
      await cleanupManager.addResource('dependent', 'file', async () => {}, {
        dependencies: ['dependency']
      });
      
      // When: Cleaning up with dependencies
      const dependentResource = cleanupManager.getResource('dependent');
      
      // Then: Should track dependencies
      expect(dependentResource?.metadata?.dependencies).toContain('dependency');
    });
  });

  describe('Concurrent operations and thread safety', () => {
    it('should handle concurrent resource additions', async () => {
      // Given: Multiple concurrent resource additions
      const addResourcePromises = Array.from({ length: 100 }, (_, i) =>
        cleanupManager.addResource(`concurrent-${i}`, 'database', async () => {})
      );
      
      // When: Adding resources concurrently
      await Promise.all(addResourcePromises);
      
      // Then: Should add all resources without conflicts
      expect(cleanupManager.getAllResources()).toHaveLength(100);
    });

    it('should handle concurrent cleanup operations', async () => {
      // Given: Resources for concurrent cleanup
      const cleanupFunctions = Array.from({ length: 50 }, () => 
        jest.fn().mockResolvedValue(undefined)
      );
      
      await Promise.all(
        cleanupFunctions.map((fn, i) =>
          cleanupManager.addResource(`cleanup-${i}`, 'database', fn)
        )
      );
      
      // When: Concurrent cleanup operations
      const cleanupPromises = Array.from({ length: 50 }, (_, i) =>
        cleanupManager.cleanupResource(`cleanup-${i}`)
      );
      
      await Promise.all(cleanupPromises);
      
      // Then: Should cleanup all resources
      cleanupFunctions.forEach(fn => {
        expect(fn).toHaveBeenCalled();
      });
      expect(cleanupManager.getAllResources()).toHaveLength(0);
    });

    it('should maintain consistency during concurrent operations', async () => {
      // Given: Mix of add and cleanup operations
      const operations = [];
      
      // Add operations
      for (let i = 0; i < 25; i++) {
        operations.push(
          cleanupManager.addResource(`mixed-${i}`, 'database', async () => {})
        );
      }
      
      // Cleanup operations (for resources that may not exist yet)
      for (let i = 10; i < 20; i++) {
        operations.push(
          cleanupManager.cleanupResource(`mixed-${i}`).catch(() => {})
        );
      }
      
      // When: Executing mixed operations concurrently
      await Promise.all(operations);
      
      // Then: Should maintain consistent state
      const resources = cleanupManager.getAllResources();
      expect(resources.length).toBeLessThanOrEqual(25);
      expect(resources.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling and recovery', () => {
    it('should handle cleanup manager initialization errors', () => {
      // Given: Invalid configuration
      const invalidConfig = {
        defaultTimeout: -1000,
        enableLogging: 'invalid' as any
      };
      
      // When: Creating cleanup manager with invalid config
      const createManager = () => new TestCleanupManager(invalidConfig);
      
      // Then: Should handle gracefully or throw meaningful error
      expect(createManager).toThrow(/Invalid configuration/);
    });

    it('should recover from hook execution errors', async () => {
      // Given: Hooks that throw errors
      const failingHooks: ResourceLifecycleHooks = {
        onResourceCreated: jest.fn().mockImplementation(() => {
          throw new Error('Hook failed');
        }),
        onResourceCleaned: jest.fn(),
        onResourceFailed: jest.fn(),
        onForceCleanup: jest.fn()
      };
      
      const resilientManager = new TestCleanupManager({
        hooks: failingHooks,
        enableLogging: false
      });
      
      // When: Adding resource with failing hook
      const addPromise = resilientManager.addResource('hook-error', 'database', async () => {});
      
      // Then: Should not fail due to hook error
      await expect(addPromise).resolves.toBeUndefined();
      expect(resilientManager.getResource('hook-error')).toBeDefined();
    });

    it('should handle resource cleanup timeouts', async () => {
      jest.useRealTimers(); // Use real timers for this test
      
      // Given: Resource with slow cleanup
      const slowCleanup = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 10000))
      );
      
      await cleanupManager.addResource('slow-cleanup', 'database', slowCleanup);
      
      // When: Cleaning up with short timeout
      const cleanupPromise = cleanupManager.cleanupResource('slow-cleanup', { timeout: 100 });
      
      // Then: Should timeout and handle gracefully
      await expect(cleanupPromise).rejects.toThrow(/timeout/i);
      
      jest.useFakeTimers();
    });

    it('should provide detailed error information', async () => {
      // Given: Resource with specific cleanup error
      const specificError = new Error('Database connection failed');
      specificError.name = 'DatabaseError';
      (specificError as any).code = 'CONN_FAILED';
      
      const failingCleanup = jest.fn().mockRejectedValue(specificError);
      await cleanupManager.addResource('detailed-error', 'database', failingCleanup);
      
      // When: Cleanup fails
      try {
        await cleanupManager.cleanupResource('detailed-error');
      } catch (error: any) {
        // Then: Should preserve error details
        expect(error.message).toBe('Database connection failed');
        expect(error.name).toBe('DatabaseError');
        expect(error.code).toBe('CONN_FAILED');
      }
    });

    it('should handle cleanup manager disposal', async () => {
      // Given: Cleanup manager with resources
      await cleanupManager.addResource('disposable', 'database', jest.fn());
      
      // When: Disposing cleanup manager
      await cleanupManager.dispose();
      
      // Then: Should cleanup all resources and prevent further operations
      expect(cleanupManager.getAllResources()).toHaveLength(0);
      
      // Further operations should be rejected
      await expect(
        cleanupManager.addResource('after-dispose', 'database', async () => {})
      ).rejects.toThrow(/disposed/i);
    });
  });
});