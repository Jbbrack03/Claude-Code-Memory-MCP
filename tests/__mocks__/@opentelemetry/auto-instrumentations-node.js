import { jest } from '@jest/globals';

// Mock auto instrumentations
export const getNodeAutoInstrumentations = jest.fn().mockReturnValue([]);

export default { getNodeAutoInstrumentations };