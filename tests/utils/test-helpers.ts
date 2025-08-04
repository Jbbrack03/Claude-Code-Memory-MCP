/**
 * Test helper utilities for timeout handling and resource management
 * Phase 13: Test Suite Stabilization
 */

import { TestCleanupManager } from './test-cleanup-manager.js';

export interface TimeoutResource {
  operationName: string;
  timeoutMs: number;
  startTime: number;
}

export interface CleanupManager {
  addTimeoutResource(resource: TimeoutResource): void;
  forceCleanup(operationName: string): Promise<void>;
}

export interface TestEnvironmentConfig {
  timeout?: number;
  cleanupOnExit?: boolean;
  trackResources?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  enablePerformanceTracking?: boolean;
}

// Global test environment state
let globalCleanupManager: TestCleanupManager | null = null;
let testEnvironmentSetup = false;
let originalJestTimeout: number | undefined;

/**
 * Wraps a promise with a timeout using Promise.race
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout duration in milliseconds
 * @param operationName - Name of the operation for error messages
 * @param cleanupManager - Optional cleanup manager for resource tracking
 * @returns Promise that resolves/rejects based on race between promise and timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName?: string,
  cleanupManager?: CleanupManager
): Promise<T> {
  const opName = operationName && operationName.trim() ? operationName : 'Operation';
  let timeoutId: NodeJS.Timeout;
  
  // Track timeout resource if cleanup manager provided
  if (cleanupManager) {
    try {
      cleanupManager.addTimeoutResource({
        operationName: opName,
        timeoutMs,
        startTime: Date.now()
      });
    } catch (error) {
      // Silently handle cleanup manager errors
    }
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(async () => {
      // Call force cleanup if available
      if (cleanupManager) {
        try {
          await cleanupManager.forceCleanup(opName);
        } catch (error) {
          // Silently handle cleanup errors
        }
      }
      reject(new Error(`${opName} timed out after ${timeoutMs}ms`));
    }, Math.max(0, timeoutMs));
  });

  return Promise.race([
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        return value;
      },
      (error) => {
        clearTimeout(timeoutId);
        throw error;
      }
    ),
    timeoutPromise
  ]);
}

/**
 * Sets up the global test environment with timeout helpers and resource management
 * @param config - Configuration for the test environment
 */
export async function setupTestEnvironment(config: TestEnvironmentConfig = {}): Promise<void> {
  if (testEnvironmentSetup) {
    return; // Already setup
  }

  const finalConfig = {
    timeout: 10000, // 10 seconds default
    cleanupOnExit: true,
    trackResources: true,
    logLevel: 'error' as const,
    enablePerformanceTracking: false,
    ...config
  };

  // Store original Jest timeout if available
  if (typeof jest !== 'undefined' && jest.setTimeout) {
    originalJestTimeout = (jest as any).getTimeout?.() || 5000;
    jest.setTimeout(finalConfig.timeout);
  }

  // Create global cleanup manager
  globalCleanupManager = new TestCleanupManager({
    defaultTimeout: finalConfig.timeout,
    enableLogging: finalConfig.logLevel !== 'error',
    hooks: {
      onResourceCreated: (resource) => {
        if (finalConfig.logLevel === 'debug') {
          console.log(`[TestHelper] Resource created: ${resource.id} (${resource.type})`);
        }
      },
      onResourceCleaned: (resourceId) => {
        if (finalConfig.logLevel === 'debug') {
          console.log(`[TestHelper] Resource cleaned: ${resourceId}`);
        }
      },
      onResourceFailed: (resourceId, error) => {
        if (finalConfig.logLevel !== 'error') {
          console.warn(`[TestHelper] Resource cleanup failed: ${resourceId}`, error.message);
        }
      },
      onForceCleanup: (operationName) => {
        if (finalConfig.logLevel === 'debug') {
          console.log(`[TestHelper] Force cleanup triggered: ${operationName}`);
        }
      }
    }
  });

  // Setup cleanup on process exit if configured
  if (finalConfig.cleanupOnExit) {
    const exitHandler = async () => {
      await teardownTestEnvironment();
    };

    process.once('exit', exitHandler);
    process.once('SIGINT', exitHandler);
    process.once('SIGTERM', exitHandler);
    process.once('uncaughtException', exitHandler);
    process.once('unhandledRejection', exitHandler);
  }

  testEnvironmentSetup = true;
}

/**
 * Tears down the global test environment and cleans up all resources
 */
export async function teardownTestEnvironment(): Promise<void> {
  if (!testEnvironmentSetup) {
    return; // Already torn down or never setup
  }

  // Cleanup all resources
  if (globalCleanupManager) {
    try {
      await globalCleanupManager.cleanup();
      await globalCleanupManager.dispose();
    } catch (error) {
      // Silently handle cleanup errors to prevent test pollution
    }
    globalCleanupManager = null;
  }

  // Restore original Jest timeout
  if (typeof jest !== 'undefined' && jest.setTimeout && originalJestTimeout) {
    jest.setTimeout(originalJestTimeout);
    originalJestTimeout = undefined;
  }

  // Clear all timers and mocks
  if (typeof jest !== 'undefined') {
    jest.clearAllTimers();
    jest.clearAllMocks();
  }

  testEnvironmentSetup = false;
}

/**
 * Gets the global cleanup manager instance
 * @returns The current TestCleanupManager instance
 * @throws Error if test environment is not setup
 */
export function getTestCleanupManager(): TestCleanupManager {
  if (!globalCleanupManager) {
    throw new Error('Test environment not setup. Call setupTestEnvironment() first.');
  }
  return globalCleanupManager;
}

/**
 * Creates a timeout wrapper for async test operations with automatic cleanup
 * @param testFn - The test function to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name for debugging
 */
export function withTestTimeout<T extends (...args: any[]) => Promise<any>>(
  testFn: T,
  timeoutMs: number = 10000,
  operationName?: string
): T {
  return (async (...args: Parameters<T>) => {
    const cleanupManager = getTestCleanupManager();
    return withTimeout(
      testFn(...args),
      timeoutMs,
      operationName || testFn.name || 'Test function',
      cleanupManager
    );
  }) as T;
}

/**
 * Utility for common Jest beforeEach setup with timeout helpers
 */
export function setupTestTimeouts(timeoutMs: number = 10000): void {
  if (typeof beforeEach !== 'undefined' && typeof jest !== 'undefined') {
    beforeEach(async () => {
      jest.setTimeout(timeoutMs);
      jest.clearAllTimers();
      jest.clearAllMocks();
      
      // Setup test environment if not already done
      if (!testEnvironmentSetup) {
        await setupTestEnvironment({ timeout: timeoutMs });
      }
    });
  }
}

/**
 * Utility for common Jest afterEach cleanup with timeout helpers
 */
export function setupTestCleanup(): void {
  if (typeof afterEach !== 'undefined' && typeof jest !== 'undefined') {
    afterEach(async () => {
      // Clean up any hanging promises
      jest.clearAllTimers();
      jest.clearAllMocks();
      
      // Clean up timeout resources
      if (globalCleanupManager) {
        globalCleanupManager.cleanupTimeoutResources();
      }
    });
  }

  if (typeof afterAll !== 'undefined') {
    afterAll(async () => {
      await teardownTestEnvironment();
    });
  }
}

/**
 * Enhanced test wrapper that provides timeout protection and resource cleanup
 * @param testName - Name of the test
 * @param testFn - Test function
 * @param timeoutMs - Timeout in milliseconds
 */
export function createTimeoutTest(
  testName: string,
  testFn: () => Promise<void>,
  timeoutMs: number = 10000
): void {
  if (typeof it !== 'undefined') {
    it(testName, async () => {
      const cleanupManager = getTestCleanupManager();
      await withTimeout(testFn(), timeoutMs, `Test: ${testName}`, cleanupManager);
    }, timeoutMs + 1000); // Jest timeout slightly longer than internal timeout
  }
}

// Re-export TestCleanupManager for convenience
export { TestCleanupManager };