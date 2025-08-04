import { describe, it, expect } from "@jest/globals";

describe('Cleanup Debug', () => {
  it('should be able to import test-cleanup-manager', async () => {
    try {
      const cleanupModule = await import('./utils/test-cleanup-manager.js');
      expect(cleanupModule).toBeDefined();
      console.log('Cleanup manager exports:', Object.keys(cleanupModule));
    } catch (error) {
      console.error('Error importing cleanup manager:', error);
      throw error;
    }
  });
});