import { jest } from '@jest/globals';

// Mock pipeline function that returns a mock model with timeout safety
export const pipeline = jest.fn().mockImplementation(async (task, model, options) => {
  // Simulate async model loading with controlled delay
  await new Promise(resolve => setTimeout(resolve, 10)); // 10ms delay
  
  // Return a mock pipeline function that simulates the model
  const mockPipeline = jest.fn().mockImplementation(async (text, config) => {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 5)); // 5ms delay
    
    // Return mock embeddings output based on task type
    if (task === 'feature-extraction') {
      return {
        data: new Float32Array(384).fill(0.1),
        pooler_output: new Float32Array(384).fill(0.1)
      };
    }
    
    // Default response
    return {
      data: new Float32Array(384).fill(0.1)
    };
  });
  
  // Add cleanup method to prevent hanging
  mockPipeline.dispose = jest.fn().mockResolvedValue(undefined);
  
  return mockPipeline;
});

// Mock environment configuration
export const env = {
  cacheDir: '/tmp/test-cache',
  allowRemoteModels: false,
  allowLocalModels: true
};

// Mock AutoModel for direct model access
export const AutoModel = {
  from_pretrained: jest.fn().mockImplementation(async (modelName, options) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      generate: jest.fn().mockResolvedValue([[1, 2, 3]]),
      encode: jest.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
      dispose: jest.fn().mockResolvedValue(undefined)
    };
  })
};

// Mock AutoTokenizer
export const AutoTokenizer = {
  from_pretrained: jest.fn().mockImplementation(async (modelName, options) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      encode: jest.fn().mockImplementation((text) => [1, 2, 3, 4, 5]),
      decode: jest.fn().mockImplementation((tokens) => 'mocked decoded text'),
      tokenize: jest.fn().mockImplementation((text) => text.split(' ')),
      dispose: jest.fn().mockResolvedValue(undefined)
    };
  })
};

export default { pipeline, env, AutoModel, AutoTokenizer };