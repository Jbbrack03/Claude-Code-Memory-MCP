// Jest setup file for common test configuration
// Extend Jest timeout for async operations
if (typeof jest !== 'undefined') {
  jest.setTimeout(10000);
}