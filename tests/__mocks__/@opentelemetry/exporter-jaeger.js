import { jest } from '@jest/globals';

// Mock Jaeger exporter
export const JaegerExporter = jest.fn().mockImplementation((config) => ({
  export: jest.fn().mockImplementation((spans, callback) => {
    callback({ code: 0 }); // Success
  }),
  shutdown: jest.fn().mockResolvedValue(undefined),
  _config: config,
}));

export default { JaegerExporter };