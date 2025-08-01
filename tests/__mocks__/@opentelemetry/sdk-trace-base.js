export class ConsoleSpanExporter {
  export(spans, resultCallback) {
    // Simulate console export
    setTimeout(() => {
      resultCallback({ code: 0 });
    }, 0);
  }
  
  shutdown() {
    return Promise.resolve();
  }
  
  forceFlush() {
    return Promise.resolve();
  }
}

export class BatchSpanProcessor {
  constructor(exporter) {
    this.exporter = exporter;
    this._finishedSpans = [];
    this._timer = null;
  }
  
  onStart(span, parentContext) {
    // No-op
  }
  
  onEnd(span) {
    this._finishedSpans.push(span);
  }
  
  shutdown() {
    if (this._timer) {
      clearTimeout(this._timer);
    }
    return this.exporter.shutdown();
  }
  
  forceFlush() {
    return this.exporter.forceFlush();
  }
}

export class SimpleSpanProcessor {
  constructor(exporter) {
    this.exporter = exporter;
  }
  
  onStart(span, parentContext) {
    // No-op
  }
  
  onEnd(span) {
    this.exporter.export([span], () => {});
  }
  
  shutdown() {
    return this.exporter.shutdown();
  }
  
  forceFlush() {
    return this.exporter.forceFlush();
  }
}