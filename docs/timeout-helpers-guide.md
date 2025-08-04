# Timeout Helpers Guide
**Phase 13: Test Suite Stabilization**

This guide explains how to use the timeout helpers and test cleanup utilities to prevent hanging operations in your test suite.

## Overview

The timeout helpers provide a robust system for:
- Wrapping promises with timeouts to prevent hanging tests
- Automatically cleaning up resources when timeouts occur
- Managing test environment lifecycle
- Tracking timeout and resource statistics

## Core Functions

### `withTimeout<T>(promise, timeoutMs, operationName?, cleanupManager?): Promise<T>`

Wraps any promise with a timeout that will reject if the promise doesn't resolve within the specified time.

```typescript
import { withTimeout } from '../utils/test-helpers.js';

// Basic usage
const result = await withTimeout(
  someAsyncOperation(),
  5000,
  'Database query'
);

// With cleanup manager
const result = await withTimeout(
  someAsyncOperation(),
  5000,
  'Database query',
  cleanupManager
);
```

**Parameters:**
- `promise`: The promise to wrap with timeout
- `timeoutMs`: Timeout duration in milliseconds
- `operationName`: Optional name for error messages and logging
- `cleanupManager`: Optional cleanup manager for resource tracking

### Test Environment Management

#### `setupTestEnvironment(config?): Promise<void>`

Sets up the global test environment with timeout helpers and resource management.

```typescript
beforeEach(async () => {
  await setupTestEnvironment({
    timeout: 10000,           // Default timeout for operations
    cleanupOnExit: true,      // Cleanup resources on process exit
    trackResources: true,     // Enable resource tracking
    logLevel: 'debug'         // Logging level
  });
});
```

#### `teardownTestEnvironment(): Promise<void>`

Cleans up the test environment and all registered resources.

```typescript
afterEach(async () => {
  await teardownTestEnvironment();
});
```

#### `getTestCleanupManager(): TestCleanupManager`

Gets the global cleanup manager instance for registering resources.

```typescript
const cleanupManager = getTestCleanupManager();
await cleanupManager.addResource('db-connection', 'database', async () => {
  await connection.close();
});
```

## Usage Patterns

### Pattern 1: Basic Test Setup

```typescript
describe('My Test Suite', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    await setupTestEnvironment({ timeout: 10000 });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await teardownTestEnvironment();
  });

  it('should handle database operations with timeout', async () => {
    const result = await withTimeout(
      database.query('SELECT * FROM users'),
      5000,
      'User query'
    );
    expect(result).toBeDefined();
  });
});
```

### Pattern 2: Resource Management

```typescript
describe('Database Tests', () => {
  let cleanupManager: TestCleanupManager;

  beforeEach(async () => {
    await setupTestEnvironment();
    cleanupManager = getTestCleanupManager();
  });

  afterEach(async () => {
    await teardownTestEnvironment();
  });

  it('should cleanup database connections on timeout', async () => {
    const connection = await database.connect();
    
    // Register resource for cleanup
    await cleanupManager.addResource('db-conn', 'database', async () => {
      await connection.close();
    });

    // This will timeout and trigger cleanup
    const promise = withTimeout(
      connection.query('SELECT * FROM huge_table'),
      2000,
      'Large query',
      cleanupManager
    );

    jest.advanceTimersByTime(2001);
    await expect(promise).rejects.toThrow('timed out');
    // Connection will be automatically closed
  });
});
```

### Pattern 3: Convenience Helpers

```typescript
describe('Simplified Test Setup', () => {
  // Automatic setup/cleanup for entire suite
  setupTestTimeouts(15000);  // 15 second timeout
  setupTestCleanup();        // Automatic cleanup

  it('should work with automatic setup', async () => {
    // Test environment is automatically setup
    const result = await withTimeout(
      someOperation(),
      5000,
      'Some operation'
    );
    expect(result).toBeDefined();
  });

  // Create tests with automatic timeout wrapping
  createTimeoutTest('should handle complex operation', async () => {
    await complexAsyncOperation();
  }, 8000);
});
```

## Resource Types

The cleanup manager supports different resource types:

- `database`: Database connections, transactions
- `file`: File handles, temporary files
- `network`: HTTP connections, sockets
- `memory`: Memory allocations, caches
- `custom`: Custom resource types

```typescript
// Database resource
await cleanupManager.addResource('db-1', 'database', async () => {
  await connection.rollback();
  await connection.close();
});

// File resource
await cleanupManager.addResource('temp-file', 'file', async () => {
  await fs.unlink(tempFilePath);
});

// Network resource
await cleanupManager.addResource('http-pool', 'network', async () => {
  await httpPool.destroy();
});

// Custom resource
await cleanupManager.addResource('cache', 'custom', async () => {
  cache.clear();
}, { size: cache.size });
```

## Monitoring and Statistics

### Resource Statistics

```typescript
const stats = cleanupManager.getStatistics();
console.log(`Total resources: ${stats.totalResources}`);
console.log(`Databases: ${stats.resourcesByType.database}`);
console.log(`Files: ${stats.resourcesByType.file}`);
```

### Timeout Statistics

```typescript
const timeoutStats = cleanupManager.getTimeoutStatistics();
console.log(`Total timeouts: ${timeoutStats.totalTimeouts}`);
console.log(`Active timeouts: ${timeoutStats.activeTimeouts}`);
console.log(`Expired timeouts: ${timeoutStats.expiredTimeouts}`);
console.log(`Average timeout: ${timeoutStats.averageTimeoutDuration}ms`);
```

## Best Practices

### 1. Always Use Descriptive Operation Names

```typescript
// Good
await withTimeout(userService.fetchProfile(userId), 3000, 'User profile fetch');

// Bad
await withTimeout(userService.fetchProfile(userId), 3000);
```

### 2. Register Resources for Cleanup

```typescript
// Always register resources that need cleanup
const connection = await database.connect();
await cleanupManager.addResource('user-db', 'database', async () => {
  await connection.close();
});
```

### 3. Use Appropriate Timeouts

```typescript
// Short timeouts for fast operations
await withTimeout(cache.get(key), 100, 'Cache lookup');

// Longer timeouts for complex operations
await withTimeout(generateReport(), 30000, 'Report generation');
```

### 4. Handle Both Timeout and Operation Errors

```typescript
try {
  const result = await withTimeout(operation(), 5000, 'Operation');
} catch (error) {
  if (error.message.includes('timed out')) {
    // Handle timeout specifically
  } else {
    // Handle operation error
  }
}
```

### 5. Use Fake Timers for Deterministic Tests

```typescript
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('should timeout after specified duration', async () => {
  const promise = withTimeout(slowOperation(), 1000, 'Slow op');
  jest.advanceTimersByTime(1001);
  await expect(promise).rejects.toThrow('timed out');
});
```

## Common Pitfalls

### 1. Not Cleaning Up Resources

```typescript
// Bad - resources leak on timeout
const connection = await database.connect();
await withTimeout(connection.query('...'), 5000);

// Good - resources are cleaned up
const connection = await database.connect();
await cleanupManager.addResource('db', 'database', () => connection.close());
await withTimeout(connection.query('...'), 5000, 'Query', cleanupManager);
```

### 2. Using Real Timers in Tests

```typescript
// Bad - tests take actual time and are flaky
it('should timeout', async () => {
  const promise = withTimeout(slowOp(), 1000);
  await expect(promise).rejects.toThrow();
}); // This takes 1+ seconds

// Good - deterministic and fast
it('should timeout', async () => {
  jest.useFakeTimers();
  const promise = withTimeout(slowOp(), 1000);
  jest.advanceTimersByTime(1001);
  await expect(promise).rejects.toThrow();
  jest.useRealTimers();
}); // This is instant
```

### 3. Not Setting Up Test Environment

```typescript
// Bad - cleanup manager not available
const cleanupManager = getTestCleanupManager(); // Throws error

// Good - proper setup
beforeEach(async () => {
  await setupTestEnvironment();
});
```

## Integration with Jest

The timeout helpers integrate seamlessly with Jest:

```typescript
// jest.config.js
module.exports = {
  testTimeout: 30000,        // 30 second Jest timeout
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts']
};

// tests/setup.ts
import { setupTestTimeouts, setupTestCleanup } from './utils/test-helpers.js';

// Global setup for all tests
setupTestTimeouts(10000);  // 10 second default timeout
setupTestCleanup();        // Automatic cleanup
```

## Performance Considerations

1. **Use appropriate timeouts**: Don't make them too short or too long
2. **Clean up resources promptly**: Use short cleanup timeouts (100ms)
3. **Avoid memory leaks**: Always register resources that allocate memory
4. **Use fake timers**: For fast, deterministic tests

## Examples

See `/Users/jbbrack03/Claude_Code_Memory_MCP/tests/examples/timeout-helpers-usage-examples.test.ts` for comprehensive usage examples covering:

- Basic timeout operations
- Resource management
- Error handling
- Concurrent operations
- Performance monitoring
- Best practices

## Troubleshooting

### Tests Are Still Hanging

1. Check if you're using `jest.useFakeTimers()`
2. Ensure `setupTestEnvironment()` is called in `beforeEach`
3. Verify all resources are registered for cleanup
4. Look for operations not wrapped with `withTimeout`

### Resources Not Being Cleaned Up

1. Ensure cleanup manager is passed to `withTimeout`
2. Check that resource cleanup functions don't throw
3. Verify `teardownTestEnvironment()` is called in `afterEach`

### Timeouts Too Short/Long

1. Monitor timeout statistics with `getTimeoutStatistics()`
2. Adjust timeouts based on actual operation performance
3. Use different timeouts for different operation types

For more help, check the test files and implementation in `/Users/jbbrack03/Claude_Code_Memory_MCP/tests/utils/`.