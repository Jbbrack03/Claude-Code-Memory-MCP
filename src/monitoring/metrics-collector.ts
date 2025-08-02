/**
 * MetricsCollector class for collecting and exposing Prometheus metrics
 */

import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

interface MetricsConfig {
  enabled?: boolean;
  prefix?: string;
  collectDefaultMetrics?: boolean;
  defaultLabels?: Record<string, string>;
}

export class MetricsCollector {
  private enabled: boolean;
  private prefix: string;
  private collectDefault: boolean;
  private defaultLabels: Record<string, string>;
  private initialized: boolean = false;
  private activeConnections: number = 0;

  // Metrics
  private requestCounter?: Counter<string>;
  private requestDurationHistogram?: Histogram<string>;
  private memoryOperationsCounter?: Counter<string>;
  private storageSizeGauge?: Gauge<string>;
  private activeConnectionsGauge?: Gauge<string>;
  private errorsCounter?: Counter<string>;
  private hookDurationHistogram?: Histogram<string>;
  private vectorSearchDurationHistogram?: Histogram<string>;
  private cacheHitRateGauge?: Gauge<string>;

  constructor(config: MetricsConfig = {}) {
    this.enabled = config.enabled ?? true;
    this.prefix = config.prefix ?? 'mcp_';
    this.collectDefault = config.collectDefaultMetrics ?? true;
    this.defaultLabels = config.defaultLabels ?? {};
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  initialize(): void {
    if (!this.enabled) {
      return;
    }

    // Clear existing metrics if re-initializing
    if (this.initialized) {
      register.clear();
    }

    // Initialize counters
    this.requestCounter = new Counter({
      name: `${this.prefix}request_total`,
      help: 'Total number of MCP requests',
      labelNames: ['tool', 'status']
    });

    this.memoryOperationsCounter = new Counter({
      name: `${this.prefix}memory_operations_total`,
      help: 'Total number of memory operations',
      labelNames: ['operation', 'status']
    });

    this.errorsCounter = new Counter({
      name: `${this.prefix}errors_total`,
      help: 'Total number of errors',
      labelNames: ['error_type', 'component']
    });

    // Initialize histograms
    this.requestDurationHistogram = new Histogram({
      name: `${this.prefix}request_duration_seconds`,
      help: 'Duration of MCP requests in seconds',
      labelNames: ['tool'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10]
    });

    this.hookDurationHistogram = new Histogram({
      name: `${this.prefix}hook_duration_seconds`,
      help: 'Duration of hook execution in seconds',
      labelNames: ['hook_type', 'status'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10]
    });

    this.vectorSearchDurationHistogram = new Histogram({
      name: `${this.prefix}vector_search_duration_seconds`,
      help: 'Duration of vector search operations in seconds',
      labelNames: ['index_type'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
    });

    // Initialize gauges
    this.storageSizeGauge = new Gauge({
      name: `${this.prefix}storage_size_bytes`,
      help: 'Current storage size in bytes',
      labelNames: ['storage_type']
    });

    this.activeConnectionsGauge = new Gauge({
      name: `${this.prefix}active_connections`,
      help: 'Number of active connections'
    });

    this.cacheHitRateGauge = new Gauge({
      name: `${this.prefix}cache_hit_rate`,
      help: 'Cache hit rate percentage',
      labelNames: ['cache_level']
    });

    // Register all metrics
    register.registerMetric(this.requestCounter);
    register.registerMetric(this.requestDurationHistogram);
    register.registerMetric(this.memoryOperationsCounter);
    register.registerMetric(this.storageSizeGauge);
    register.registerMetric(this.activeConnectionsGauge);
    register.registerMetric(this.errorsCounter);
    register.registerMetric(this.hookDurationHistogram);
    register.registerMetric(this.vectorSearchDurationHistogram);
    register.registerMetric(this.cacheHitRateGauge);

    // Collect default metrics if enabled
    if (this.collectDefault) {
      collectDefaultMetrics({ register, labels: this.defaultLabels });
    }

    this.initialized = true;
  }

  recordRequest(tool: string, status: string): void {
    if (!this.enabled || !this.requestCounter) {
      return;
    }

    try {
      this.requestCounter.labels(tool, status).inc(1);
    } catch (error) {
      // Gracefully handle errors
    }
  }

  recordRequestDuration(tool: string, duration: number): void {
    if (!this.enabled || !this.requestDurationHistogram) {
      return;
    }

    try {
      // Handle invalid values
      if (isNaN(duration) || !isFinite(duration) || duration < 0) {
        return;
      }
      this.requestDurationHistogram.labels(tool).observe(duration);
    } catch (error) {
      // Gracefully handle errors
    }
  }

  startRequestTimer(tool: string): () => void {
    if (!this.enabled || !this.requestDurationHistogram) {
      return () => {};
    }

    try {
      return this.requestDurationHistogram.labels(tool).startTimer();
    } catch (error) {
      return () => {};
    }
  }

  recordMemoryOperation(operation: string, status: string): void {
    if (!this.enabled || !this.memoryOperationsCounter) {
      return;
    }

    try {
      this.memoryOperationsCounter.labels(operation, status).inc(1);
    } catch (error) {
      // Gracefully handle errors
    }
  }

  updateStorageSize(storageType: string, sizeBytes: number): void {
    if (!this.enabled || !this.storageSizeGauge) {
      return;
    }

    try {
      this.storageSizeGauge.labels(storageType).set(sizeBytes);
    } catch (error) {
      // Gracefully handle errors
    }
  }

  setActiveConnections(count: number): void {
    if (!this.enabled || !this.activeConnectionsGauge) {
      return;
    }

    try {
      this.activeConnections = Math.max(0, count);
      this.activeConnectionsGauge.set(this.activeConnections);
    } catch (error) {
      // Gracefully handle errors
    }
  }

  incrementConnections(): void {
    if (!this.enabled || !this.activeConnectionsGauge) {
      return;
    }

    try {
      this.activeConnections++;
      this.activeConnectionsGauge.inc(1);
    } catch (error) {
      // Gracefully handle errors
    }
  }

  decrementConnections(): void {
    if (!this.enabled || !this.activeConnectionsGauge) {
      return;
    }

    try {
      if (this.activeConnections > 0) {
        this.activeConnections--;
        this.activeConnectionsGauge.dec(1);
      } else {
        // Ensure we don't go below 0
        this.setActiveConnections(0);
      }
    } catch (error) {
      // Gracefully handle errors
    }
  }

  recordError(errorType: string, component: string): void {
    if (!this.enabled || !this.errorsCounter) {
      return;
    }

    try {
      this.errorsCounter.labels(errorType, component).inc(1);
    } catch (error) {
      // Gracefully handle errors
    }
  }

  recordHookDuration(hookType: string, status: string, duration: number): void {
    if (!this.enabled || !this.hookDurationHistogram) {
      return;
    }

    try {
      // Handle invalid values
      if (isNaN(duration) || !isFinite(duration) || duration < 0) {
        return;
      }
      this.hookDurationHistogram.labels(hookType, status).observe(duration);
    } catch (error) {
      // Gracefully handle errors
    }
  }

  startHookTimer(hookType: string, status?: string): () => void {
    if (!this.enabled || !this.hookDurationHistogram) {
      return () => {};
    }

    try {
      return this.hookDurationHistogram.labels(hookType, status || 'unknown').startTimer();
    } catch (error) {
      return () => {};
    }
  }

  recordVectorSearchDuration(indexType: string, duration: number): void {
    if (!this.enabled || !this.vectorSearchDurationHistogram) {
      return;
    }

    try {
      // Handle invalid values
      if (isNaN(duration) || !isFinite(duration) || duration < 0) {
        return;
      }
      this.vectorSearchDurationHistogram.labels(indexType).observe(duration);
    } catch (error) {
      // Gracefully handle errors
    }
  }

  startVectorSearchTimer(indexType: string): () => void {
    if (!this.enabled || !this.vectorSearchDurationHistogram) {
      return () => {};
    }

    try {
      return this.vectorSearchDurationHistogram.labels(indexType).startTimer();
    } catch (error) {
      return () => {};
    }
  }

  updateCacheHitRate(cacheLevel: string, hitRate: number): void {
    if (!this.enabled || !this.cacheHitRateGauge) {
      return;
    }

    try {
      // Clamp hit rate to valid range (0-100)
      const clampedRate = Math.max(0, Math.min(100, hitRate));
      this.cacheHitRateGauge.labels(cacheLevel).set(clampedRate);
    } catch (error) {
      // Gracefully handle errors
    }
  }

  async getMetrics(): Promise<string> {
    if (!this.enabled) {
      return '';
    }

    return register.metrics();
  }

  getMetricsAsJSON(): unknown {
    if (!this.enabled) {
      return [];
    }

    return register.getMetricsAsJSON();
  }

  shutdown(): void {
    register.clear();
    this.initialized = false;
  }
}