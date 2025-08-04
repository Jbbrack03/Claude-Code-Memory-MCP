// Jest setup file for common test configuration
import { TestCleanupManager, ResourceType } from './utils/test-cleanup-manager.js';

// Extend Jest timeout for async operations
if (typeof jest !== 'undefined') {
  jest.setTimeout(10000);
}

// Global test environment state
let globalCleanupManager: TestCleanupManager | undefined;
let testEnvironmentInitialized = false;
let originalEnv: NodeJS.ProcessEnv = {};

export interface TestEnvironmentConfig {
  timeout?: number;
  cleanupOnExit?: boolean;
  trackResources?: boolean;
  logLevel?: string;
  customSetup?: () => Promise<void>;
  environmentOverrides?: Record<string, string>;
  setupExitHandlers?: boolean;
  trackMemoryUsage?: boolean;
  includeUtilities?: boolean;
  jestIntegration?: {
    beforeEach?: () => void;
    afterEach?: () => void;
  };
}

/**
 * Setup test environment with configuration
 */
export async function setupTestEnvironment(config: TestEnvironmentConfig = {}): Promise<void> {
  // Store original environment
  originalEnv = { ...process.env };

  // Set test environment
  process.env.NODE_ENV = 'test';

  // Apply environment overrides
  if (config.environmentOverrides) {
    Object.assign(process.env, config.environmentOverrides);
  }

  // Initialize cleanup manager
  globalCleanupManager = new TestCleanupManager({
    defaultTimeout: config.timeout || 10000,
    enableLogging: config.logLevel !== 'silent'
  });

  // Setup exit handlers if requested
  if (config.setupExitHandlers) {
    process.on('SIGINT', () => {
      process.exit(0);
    });
  }

  // Run custom setup
  if (config.customSetup) {
    await config.customSetup();
  }

  testEnvironmentInitialized = true;
}

/**
 * Teardown test environment and cleanup resources
 */
export async function teardownTestEnvironment(): Promise<void> {
  if (globalCleanupManager) {
    await globalCleanupManager.cleanup().catch(() => {});
    globalCleanupManager = undefined;
  }

  // Restore original environment
  process.env = originalEnv;
  testEnvironmentInitialized = false;
}

/**
 * Get the global test cleanup manager
 */
export function getTestCleanupManager(): TestCleanupManager {
  if (!globalCleanupManager) {
    throw new Error('Test environment not initialized. Call setupTestEnvironment() first.');
  }
  return globalCleanupManager;
}

/**
 * Register a test resource for cleanup tracking
 */
export async function registerTestResource(
  id: string,
  type: ResourceType,
  cleanupFn?: () => Promise<void>
): Promise<void> {
  const manager = getTestCleanupManager();
  const defaultCleanupFn = cleanupFn || (async () => {});
  await manager.addResource(id, type, defaultCleanupFn);
}

/**
 * Cleanup test resources by type or all resources
 */
export async function cleanupTestResources(type?: ResourceType): Promise<void> {
  if (!globalCleanupManager) {
    return;
  }

  if (type) {
    await globalCleanupManager.cleanupByType(type);
  } else {
    await globalCleanupManager.cleanup();
  }
}

/**
 * Setup test timeout with optional custom handler
 */
export function setupTestTimeout(
  timeoutMs: number = 30000,
  timeoutHandler?: () => void
): number {
  const handler = timeoutHandler || (() => {
    throw new Error(`Test timed out after ${timeoutMs}ms`);
  });

  return setTimeout(handler, timeoutMs) as unknown as number;
}