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

class Summary {
  constructor() {
    return {
      observe: () => {},
      reset: () => {},
      get: () => {},
      labels: () => this,
      startTimer: () => () => {}
    };
  }
}

class Registry {
  constructor() {
    this._cleared = false;
    this._prefix = 'test';
    this.metrics = () => {
      if (this._cleared) return Promise.resolve('');
      // Return a mock that includes metric names based on prefix
      return Promise.resolve(`# Mock metrics
# HELP ${this._prefix}_memory_captures_total Total number of memory capture operations
# TYPE ${this._prefix}_memory_captures_total counter
${this._prefix}_memory_captures_total{event_type="test",status="success"} 1

# HELP ${this._prefix}_operation_duration_seconds Duration of operations in seconds
# TYPE ${this._prefix}_operation_duration_seconds histogram
${this._prefix}_operation_duration_seconds_bucket{le="0.005"} 0

# HELP ${this._prefix}_memory_usage_bytes Current memory usage in bytes
# TYPE ${this._prefix}_memory_usage_bytes gauge
${this._prefix}_memory_usage_bytes{type="heap"} 1024`);
    };
    this.resetMetrics = () => { this._cleared = true; };
    this.setDefaultLabels = (labels) => {
      // Extract prefix from labels if available
      if (labels && labels.prefix) {
        this._prefix = labels.prefix;
      }
    };
    this.clear = () => { this._cleared = true; };
    this.getSingleMetric = () => null;
    this.registerMetric = () => {};
    this.getMetricsAsJSON = () => [];
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

export { Counter, Histogram, Gauge, Summary, Registry, register, collectDefaultMetrics };