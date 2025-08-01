export class OTLPTraceExporter {
  constructor(config = {}) {
    this.url = config.url || 'http://localhost:4318/v1/traces';
    this.headers = config.headers || {};
    this.hostname = config.hostname;
    this.compression = config.compression;
    this.timeoutMillis = config.timeoutMillis || 10000;
    this.concurrencyLimit = config.concurrencyLimit;
  }
  
  export(spans, resultCallback) {
    // Simulate successful export
    setTimeout(() => {
      resultCallback({ code: 0 });
    }, 10);
  }
  
  shutdown() {
    return Promise.resolve();
  }
  
  forceFlush() {
    return Promise.resolve();
  }
}