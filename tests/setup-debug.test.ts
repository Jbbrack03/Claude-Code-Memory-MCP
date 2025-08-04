import { describe, it, expect } from "@jest/globals";

describe('Setup Debug', () => {
  it('should be able to import setup module', async () => {
    const setupModule = await import('./setup.js');
    expect(setupModule).toBeDefined();
    console.log('Available exports:', Object.keys(setupModule));
  });
});