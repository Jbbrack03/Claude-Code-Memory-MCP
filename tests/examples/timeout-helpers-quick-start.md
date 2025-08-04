# Timeout Helpers Quick Start Guide

## Basic Usage

```typescript
import { withTimeout, setupTestEnvironment, teardownTestEnvironment, getTestCleanupManager } from '../utils/test-helpers.js';

describe('My Tests', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await setupTestEnvironment({ timeout: 10000 });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await teardownTestEnvironment();
  });

  it('should handle database operations with timeout', async () => {
    // Wrap any promise that might hang
    const result = await withTimeout(
      database.query('SELECT * FROM users'),
      5000, // 5 second timeout
      'Database query' // Operation name for error messages
    );
    expect(result).toBeDefined();
  });

  it('should cleanup resources on timeout', async () => {
    const cleanupManager = getTestCleanupManager();
    const connection = await database.connect();
    
    // Register resource for automatic cleanup
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
    // Connection is automatically closed
  });
});
```

## Key Features

1. **Timeout Protection**: Prevents hanging tests with configurable timeouts
2. **Resource Cleanup**: Automatically cleans up resources when timeouts occur
3. **Jest Integration**: Works seamlessly with Jest fake timers
4. **Error Handling**: Clear error messages distinguish timeouts from operation failures
5. **Statistics**: Monitor timeout and resource usage patterns

## Common Patterns

### Pattern 1: Basic Test Setup
```typescript
beforeEach(async () => {
  jest.useFakeTimers();
  await setupTestEnvironment();
});
```

### Pattern 2: Resource Management
```typescript
const cleanupManager = getTestCleanupManager();
await cleanupManager.addResource('resource-id', 'database', cleanupFunction);
```

### Pattern 3: Timeout Wrapping
```typescript
const result = await withTimeout(operation(), 5000, 'Operation name', cleanupManager);
```

See the full documentation at `/Users/jbbrack03/Claude_Code_Memory_MCP/docs/timeout-helpers-guide.md` for complete usage examples and best practices.