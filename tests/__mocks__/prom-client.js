/**
 * Manual mock for prom-client module
 * Used in tests to avoid actual Prometheus metric collection
 */

// Create mock instances that can be easily configured in tests
let mockCounterInstance;
let mockHistogramInstance;
let mockGaugeInstance;

const createMockCounter = () => {
  const labels = () => mockCounterInstance;
  return {
    inc: () => {},
    reset: () => {},
    get: () => {},
    labels
  };
};

const createMockHistogram = () => {
  const labels = () => mockHistogramInstance;
  return {
    observe: () => {},
    reset: () => {},
    get: () => {},
    labels,
    startTimer: () => () => {}
  };
};

const createMockGauge = () => {
  const labels = () => mockGaugeInstance;
  return {
    set: () => {},
    inc: () => {},
    dec: () => {},
    reset: () => {},
    get: () => {},
    labels
  };
};

class Counter {
  constructor() {
    mockCounterInstance = createMockCounter();
    return mockCounterInstance;
  }
  
  static __getMockInstance() {
    return mockCounterInstance;
  }
}

class Histogram {
  constructor() {
    mockHistogramInstance = createMockHistogram();
    return mockHistogramInstance;
  }
  
  static __getMockInstance() {
    return mockHistogramInstance;
  }
}

class Gauge {
  constructor() {
    mockGaugeInstance = createMockGauge();
    return mockGaugeInstance;
  }
  
  static __getMockInstance() {
    return mockGaugeInstance;
  }
}

const register = {
  clear: () => {},
  metrics: () => Promise.resolve('# Mock metrics'),
  getSingleMetric: () => null,
  registerMetric: () => {},
  getMetricsAsJSON: () => []
};

const collectDefaultMetrics = () => {};

export { Counter, Histogram, Gauge, register, collectDefaultMetrics };