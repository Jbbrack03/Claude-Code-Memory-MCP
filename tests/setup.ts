// Jest setup file for common test configuration
import { jest, afterAll } from "@jest/globals";

// Extend Jest timeout for async operations
jest.setTimeout(10000);

// Clean up any test databases on exit
afterAll(async () => {
  // Cleanup will be handled by individual tests
});