import { jest } from '@jest/globals';

// Mock trace API
export const trace = {
  getTracer: jest.fn().mockReturnValue({
    startSpan: jest.fn(),
    startActiveSpan: jest.fn(),
  }),
  setSpan: jest.fn(),
  getActiveSpan: jest.fn(),
  deleteSpan: jest.fn(),
  setSpanContext: jest.fn(),
  getSpanContext: jest.fn(),
};

// Mock context API
export const context = {
  active: jest.fn().mockReturnValue({}),
  with: jest.fn().mockImplementation((ctx, fn) => fn()),
  bind: jest.fn(),
};

// Mock propagation API
export const propagation = {
  inject: jest.fn(),
  extract: jest.fn().mockReturnValue({}),
};

// Mock span status codes
export const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
};

// Mock span kinds
export const SpanKind = {
  INTERNAL: 0,
  SERVER: 1,
  CLIENT: 2,
  PRODUCER: 3,
  CONSUMER: 4,
};

export default {
  trace,
  context,
  propagation,
  SpanStatusCode,
  SpanKind,
};