import { describe, it, expect } from "@jest/globals";

describe('Setup Minimal Debug', () => {
  it('should be able to import minimal setup module', async () => {
    const setupModule = await import('./setup-minimal.js');
    expect(setupModule).toBeDefined();
    console.log('Minimal exports:', Object.keys(setupModule));
  });
});