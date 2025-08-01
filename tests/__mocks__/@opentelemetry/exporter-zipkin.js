import { jest } from '@jest/globals';

// Mock Zipkin exporter
export const ZipkinExporter = jest.fn().mockImplementation((config) => ({
  export: jest.fn().mockImplementation((spans, callback) => {
    callback({ code: 0 }); // Success
  }),
  shutdown: jest.fn().mockResolvedValue(undefined),
  _config: config,
}));

export default { ZipkinExporter };