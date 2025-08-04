import { describe, it, expect } from "@jest/globals";

// Simple test to check if we can define exports
export function simpleFunction() {
  return 'hello';
}

describe('Setup Simple', () => {
  it('should be able to access simple function', () => {
    expect(simpleFunction()).toBe('hello');
  });
});