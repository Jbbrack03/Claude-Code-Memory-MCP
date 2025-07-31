import { jest } from '@jest/globals';

// Jest setup file for common test configuration
// Extend Jest timeout for async operations
jest.setTimeout(30000); // Increased for performance tests

// Mock global.gc if not available
if (!global.gc) {
  global.gc = jest.fn();
}