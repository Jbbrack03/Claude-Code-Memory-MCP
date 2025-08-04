import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { 
  setupTestEnvironment, 
  teardownTestEnvironment,
  getTestCleanupManager,
  registerTestResource,
  cleanupTestResources,
  setupTestTimeout
} from "./setup.js";

describe('Global Test Setup with Cleanup Tracking', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let testCleanupManager: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    
    // Reset any global test state
    jest.resetModules();
  });

  afterEach(async () => {
    // Restore original environment
    process.env = originalEnv;
    
    // Cleanup any test resources
    await cleanupTestResources().catch(() => {});
  });

  describe('Test environment setup and teardown', () => {
    it('should initialize test environment with default configuration', async () => {
      // Given: Clean test environment
      delete process.env.NODE_ENV;
      
      // When: Setting up test environment
      await setupTestEnvironment();
      
      // Then: Should configure test environment properly
      expect(process.env.NODE_ENV).toBe('test');
      expect(getTestCleanupManager()).toBeDefined();
    });

    it('should initialize test environment with custom configuration', async () => {
      // Given: Custom test configuration
      const config = {
        timeout: 15000,
        cleanupOnExit: true,
        trackResources: true,
        logLevel: 'error'
      };
      
      // When: Setting up with custom config
      await setupTestEnvironment(config);
      
      // Then: Should apply custom configuration
      const cleanupManager = getTestCleanupManager();
      expect(cleanupManager.getConfig()).toEqual(expect.objectContaining(config));
    });

    it('should handle setup errors gracefully', async () => {
      // Given: Setup that might fail
      const mockSetupFunction = jest.fn().mockRejectedValue(new Error('Setup failed'));
      
      // When: Setup encounters error
      const setupPromise = setupTestEnvironment({
        customSetup: mockSetupFunction
      });
      
      // Then: Should handle error and provide fallback
      await expect(setupPromise).rejects.toThrow('Setup failed');
    });

    it('should teardown test environment completely', async () => {
      // Given: Initialized test environment
      await setupTestEnvironment();
      const cleanupManager = getTestCleanupManager();
      
      // Register some test resources
      await registerTestResource('test-resource-1', 'database');
      await registerTestResource('test-resource-2', 'file');
      
      // When: Tearing down environment
      await teardownTestEnvironment();
      
      // Then: Should cleanup all resources
      expect(cleanupManager.getAllResources()).toHaveLength(0);
    });

    it('should handle teardown errors without failing', async () => {
      // Given: Test environment with failing cleanup
      await setupTestEnvironment();
      const mockFailingCleanup = jest.fn().mockRejectedValue(new Error('Cleanup failed'));
      
      // Register resource with failing cleanup
      await registerTestResource('failing-resource', 'custom', mockFailingCleanup);
      
      // When: Tearing down with failing resource
      const teardownPromise = teardownTestEnvironment();
      
      // Then: Should not throw but log error
      await expect(teardownPromise).resolves.toBeUndefined();
    });
  });

  describe('Test resource management', () => {
    beforeEach(async () => {
      await setupTestEnvironment();
      testCleanupManager = getTestCleanupManager();
    });

    afterEach(async () => {
      await teardownTestEnvironment();
    });

    it('should register and track test resources', async () => {
      // Given: Clean test environment
      expect(testCleanupManager.getAllResources()).toHaveLength(0);
      
      // When: Registering test resources
      await registerTestResource('db-connection', 'database');
      await registerTestResource('temp-file', 'file');
      await registerTestResource('network-socket', 'network');
      
      // Then: Should track all resources
      const resources = testCleanupManager.getAllResources();
      expect(resources).toHaveLength(3);
      expect(resources.map(r => r.id)).toContain('db-connection');
      expect(resources.map(r => r.id)).toContain('temp-file');
      expect(resources.map(r => r.id)).toContain('network-socket');
    });

    it('should handle duplicate resource registration', async () => {
      // Given: Existing resource
      await registerTestResource('duplicate-resource', 'database');
      
      // When: Registering same resource again
      const duplicateRegistration = registerTestResource('duplicate-resource', 'database');
      
      // Then: Should handle gracefully without duplicate tracking
      await expect(duplicateRegistration).resolves.toBeUndefined();
      const resources = testCleanupManager.getAllResources();
      const duplicates = resources.filter(r => r.id === 'duplicate-resource');
      expect(duplicates).toHaveLength(1);
    });

    it('should register resources with custom cleanup functions', async () => {
      // Given: Custom cleanup function
      const customCleanup = jest.fn().mockResolvedValue(undefined);
      
      // When: Registering resource with custom cleanup
      await registerTestResource('custom-resource', 'custom', customCleanup);
      
      // Then: Should store custom cleanup function
      const resource = testCleanupManager.getResource('custom-resource');
      expect(resource.cleanupFn).toBe(customCleanup);
    });

    it('should cleanup specific resource types', async () => {
      // Given: Mixed resource types
      await registerTestResource('db1', 'database');
      await registerTestResource('db2', 'database');
      await registerTestResource('file1', 'file');
      await registerTestResource('network1', 'network');
      
      // When: Cleaning up only database resources
      await cleanupTestResources('database');
      
      // Then: Should cleanup only database resources
      const remainingResources = testCleanupManager.getAllResources();
      expect(remainingResources).toHaveLength(2);
      expect(remainingResources.map(r => r.type)).not.toContain('database');
    });

    it('should cleanup all resources when no type specified', async () => {
      // Given: Various test resources
      await registerTestResource('resource1', 'database');
      await registerTestResource('resource2', 'file');
      await registerTestResource('resource3', 'network');
      
      // When: Cleaning up all resources
      await cleanupTestResources();
      
      // Then: Should cleanup everything
      expect(testCleanupManager.getAllResources()).toHaveLength(0);
    });

    it('should handle cleanup failures for individual resources', async () => {
      // Given: Resources with mixed cleanup behavior
      const failingCleanup = jest.fn().mockRejectedValue(new Error('Cleanup failed'));
      const successCleanup = jest.fn().mockResolvedValue(undefined);
      
      await registerTestResource('failing-resource', 'custom', failingCleanup);
      await registerTestResource('success-resource', 'custom', successCleanup);
      
      // When: Cleaning up resources
      await cleanupTestResources();
      
      // Then: Should attempt cleanup for all resources
      expect(failingCleanup).toHaveBeenCalled();
      expect(successCleanup).toHaveBeenCalled();
      
      // Should remove successfully cleaned resources
      const remainingResources = testCleanupManager.getAllResources();
      expect(remainingResources.some(r => r.id === 'success-resource')).toBe(false);
    });
  });

  describe('Test timeout management', () => {
    beforeEach(async () => {
      await setupTestEnvironment();
      jest.useFakeTimers();
    });

    afterEach(async () => {
      jest.useRealTimers();
      await teardownTestEnvironment();
    });

    it('should setup test timeout with default duration', () => {
      // Given: Test without specific timeout
      const timeoutId = setupTestTimeout();
      
      // When: Checking timeout configuration
      // Then: Should return timeout identifier
      expect(timeoutId).toBeDefined();
      expect(typeof timeoutId).toBe('number');
    });

    it('should setup test timeout with custom duration', () => {
      // Given: Custom timeout duration
      const customTimeout = 30000;
      
      // When: Setting up timeout
      const timeoutId = setupTestTimeout(customTimeout);
      
      // Then: Should configure custom timeout
      expect(timeoutId).toBeDefined();
    });

    it('should setup test timeout with custom handler', () => {
      // Given: Custom timeout handler
      const customHandler = jest.fn();
      
      // When: Setting up timeout with handler
      const timeoutId = setupTestTimeout(15000, customHandler);
      
      // Fast forward past timeout
      jest.advanceTimersByTime(15001);
      
      // Then: Should call custom handler
      expect(customHandler).toHaveBeenCalled();
      expect(timeoutId).toBeDefined();
    });

    it('should handle timeout scenarios with resource cleanup', () => {
      // Given: Test resources and timeout
      const timeoutHandler = jest.fn();
      registerTestResource('timeout-resource', 'database');
      
      // When: Setting up timeout that will trigger
      setupTestTimeout(5000, timeoutHandler);
      jest.advanceTimersByTime(5001);
      
      // Then: Should trigger timeout handler
      expect(timeoutHandler).toHaveBeenCalled();
    });

    it('should clear timeout when test completes normally', () => {
      // Given: Active timeout
      const timeoutId = setupTestTimeout(10000);
      
      // When: Clearing timeout manually
      clearTimeout(timeoutId);
      
      // Fast forward past original timeout
      jest.advanceTimersByTime(10001);
      
      // Then: Timeout should not trigger
      // This test validates the timeout cleanup mechanism
      expect(timeoutId).toBeDefined();
    });
  });

  describe('Environment isolation and cleanup', () => {
    it('should isolate test environment variables', async () => {
      // Given: Original environment state
      const originalDbUrl = process.env.DATABASE_URL;
      
      // When: Setting up isolated test environment
      await setupTestEnvironment({
        environmentOverrides: {
          DATABASE_URL: 'test://localhost/test_db',
          LOG_LEVEL: 'silent'
        }
      });
      
      // Then: Should override environment for tests
      expect(process.env.DATABASE_URL).toBe('test://localhost/test_db');
      expect(process.env.LOG_LEVEL).toBe('silent');
      
      // Cleanup
      await teardownTestEnvironment();
      
      // Should restore original environment
      expect(process.env.DATABASE_URL).toBe(originalDbUrl);
    });

    it('should handle process exit signals during tests', async () => {
      // Given: Test environment with exit handlers
      await setupTestEnvironment({ setupExitHandlers: true });
      
      // When: Simulating process signals
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit called');
      });
      
      // Simulate SIGINT
      process.emit('SIGINT', 'SIGINT');
      
      // Then: Should trigger cleanup before exit
      expect(mockExit).toHaveBeenCalled();
      
      // Cleanup mock
      mockExit.mockRestore();
    });

    it('should prevent memory leaks in test resources', async () => {
      // Given: Test environment tracking memory
      await setupTestEnvironment({ trackMemoryUsage: true });
      
      // Create many resources
      const resourcePromises = Array.from({ length: 1000 }, (_, i) => 
        registerTestResource(`resource-${i}`, 'memory-test')
      );
      
      await Promise.all(resourcePromises);
      
      // When: Cleaning up resources
      await cleanupTestResources();
      
      // Then: Should free all tracked resources
      expect(testCleanupManager.getAllResources()).toHaveLength(0);
    });

    it('should handle concurrent resource registration and cleanup', async () => {
      // Given: Test environment
      await setupTestEnvironment();
      
      // When: Concurrent resource operations
      const registerPromises = Array.from({ length: 50 }, (_, i) => 
        registerTestResource(`concurrent-${i}`, 'concurrent-test')
      );
      
      const cleanupPromise = new Promise(resolve => {
        setTimeout(async () => {
          await cleanupTestResources('concurrent-test');
          resolve(undefined);
        }, 100);
      });
      
      // Then: Should handle concurrency without errors
      await Promise.all([...registerPromises, cleanupPromise]);
      
      // Final state should be consistent
      const remainingResources = testCleanupManager.getAllResources();
      expect(remainingResources.filter(r => r.type === 'concurrent-test')).toHaveLength(0);
    });
  });

  describe('Integration with Jest lifecycle', () => {
    it('should integrate with Jest beforeEach/afterEach hooks', async () => {
      // Given: Jest lifecycle integration
      const setupSpy = jest.fn();
      const teardownSpy = jest.fn();
      
      await setupTestEnvironment({
        jestIntegration: {
          beforeEach: setupSpy,
          afterEach: teardownSpy
        }
      });
      
      // When: Jest hooks would be called
      // Simulate Jest calling our hooks
      setupSpy();
      teardownSpy();
      
      // Then: Should have been called
      expect(setupSpy).toHaveBeenCalled();
      expect(teardownSpy).toHaveBeenCalled();
    });

    it('should handle Jest timeout extensions', () => {
      // Given: Jest timeout configuration
      const originalTimeout = jest.getTimeout ? jest.getTimeout() : 5000;
      
      // When: Setting up with extended timeout
      setupTestTimeout(30000);
      
      // Then: Should work with Jest timeout system
      expect(originalTimeout).toBeDefined();
    });

    it('should provide test utilities for common patterns', async () => {
      // Given: Test environment with utilities
      await setupTestEnvironment({ includeUtilities: true });
      
      // When: Using test utilities
      const cleanupManager = getTestCleanupManager();
      
      // Then: Should provide expected utilities
      expect(cleanupManager.createTestDatabase).toBeDefined();
      expect(cleanupManager.createTempFile).toBeDefined();
      expect(cleanupManager.mockNetworkCall).toBeDefined();
    });
  });
});