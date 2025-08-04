/**
 * Enhanced Jest setup with comprehensive timeout and cleanup handling
 */
const { TestCleanupManager } = require('./utils/test-cleanup-manager.js');

// Global cleanup manager
let globalCleanupManager: TestCleanupManager;

// Track all active systems for cleanup
const activeSystems: { close(): Promise<void> }[] = [];
const activeTimers: NodeJS.Timeout[] = [];
const activePromises: Promise<any>[] = [];

// Shorter test timeouts to prevent hanging
jest.setTimeout(10000); // 10 second timeout per test

// Disable actual monitoring and external services in tests
process.env.NODE_ENV = 'test';
process.env.MONITORING_ENABLED = 'false';
process.env.TRACING_ENABLED = 'false';
process.env.METRICS_ENABLED = 'false';
process.env.ALERTS_ENABLED = 'false';
process.env.CACHE_ENABLED = 'false';
process.env.VECTOR_INDEX_TYPE = 'simple';

// Mock console.log/warn/error to reduce noise
const originalConsole = { ...console };
beforeAll(() => {
  globalCleanupManager = new TestCleanupManager({
    defaultTimeout: 5000,
    enableLogging: false
  });
  
  // Reduce console noise but keep errors
  console.log = jest.fn();
  console.warn = jest.fn();
  console.info = jest.fn();
  console.debug = jest.fn();
});

// Setup before each test
beforeEach(async () => {
  // Clear all previous timers
  jest.clearAllTimers();
  jest.clearAllMocks();
  
  // Reset test state
  activeTimers.length = 0;
  activePromises.length = 0;
});

// Cleanup after each test
afterEach(async () => {
  // Clear any remaining timers
  activeTimers.forEach(timer => clearTimeout(timer));
  activeTimers.length = 0;
  
  // Wait briefly for any remaining async operations
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // Force cleanup of test resources
  if (globalCleanupManager) {
    await globalCleanupManager.cleanup().catch(() => {
      // Ignore cleanup errors in tests
    });
  }
});

// Global cleanup on exit
afterAll(async () => {
  // Cleanup all active systems
  await Promise.all(
    activeSystems.map(system => 
      system.close().catch(err => {
        // Ignore cleanup errors
      })
    )
  );
  
  // Final cleanup manager disposal
  if (globalCleanupManager) {
    await globalCleanupManager.dispose().catch(() => {
      // Ignore errors
    });
  }
  
  // Restore console
  Object.assign(console, originalConsole);
});

// Helper to register systems for cleanup
export const registerForCleanup = (system: { close(): Promise<void> }) => {
  activeSystems.push(system);
};

// Helper to track timers for cleanup
export const trackTimer = (timer: NodeJS.Timeout) => {
  activeTimers.push(timer);
  return timer;
};

// Helper to track promises for cleanup
export const trackPromise = <T>(promise: Promise<T>): Promise<T> => {
  activePromises.push(promise);
  return promise;
};

// Export globals for test use
export { globalCleanupManager };