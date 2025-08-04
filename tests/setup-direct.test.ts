import { describe, it, expect } from "@jest/globals";
import { setupTestEnvironment, teardownTestEnvironment, getTestCleanupManager } from "./setup.js";

describe('Setup Direct Test', () => {
  it('should be able to call setupTestEnvironment', async () => {
    await setupTestEnvironment();
    const manager = getTestCleanupManager();
    expect(manager).toBeDefined();
    await teardownTestEnvironment();
  });
});