import { jest } from '@jest/globals';

export const HierarchicalNSW = jest.fn().mockImplementation(() => ({
  initIndex: jest.fn(),
  readIndex: jest.fn(),
  writeIndex: jest.fn(),
  addItems: jest.fn(),
  addPoint: jest.fn(),
  searchKnn: jest.fn().mockImplementation((query, k) => ({
    neighbors: Array(Math.min(k, 2)).fill(0).map((_, i) => i),
    distances: Array(Math.min(k, 2)).fill(0).map((_, i) => i * 0.1)
  })),
  markDeleted: jest.fn(),
  unmarkDeleted: jest.fn(),
  getMaxElements: jest.fn().mockReturnValue(0),
  getCurrentCount: jest.fn().mockReturnValue(3),
  resizeIndex: jest.fn()
}));

export const L2Space = jest.fn();
export const InnerProductSpace = jest.fn();

export default {
  HierarchicalNSW,
  L2Space,
  InnerProductSpace
};