import { jest } from '@jest/globals';

// Mock pipeline function that returns a mock model
export const pipeline = jest.fn().mockImplementation(async (task, model, options) => {
  // Return a mock pipeline function that simulates the model
  const mockPipeline = jest.fn().mockImplementation(async (text, config) => {
    // Return mock embeddings output
    return {
      data: new Float32Array(384).fill(0.1)
    };
  });
  
  return mockPipeline;
});

export default { pipeline };