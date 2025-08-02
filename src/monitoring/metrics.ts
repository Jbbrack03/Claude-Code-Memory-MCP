import { Registry, Counter, Histogram, Gauge, Summary } from 'prom-client';
import { EventEmitter } from 'events';

export interface MetricsConfig {
  prefix?: string;
  defaultLabels?: Record<string, string>;
  enableDefaultMetrics?: boolean;
  gcDurationBuckets?: number[];
}

export class MetricsCollector extends EventEmitter {
  private registry: Registry;
  private config: Required<MetricsConfig>;
  
  // Operation metrics
  private memoryCaptures!: Counter<string>;
  private memoryRetrievals!: Counter<string>;
  private contextBuilds!: Counter<string>;
  private hookExecutions!: Counter<string>;
  
  // Performance metrics
  private operationDuration!: Histogram<string>;
  private queryLatency!: Summary<string>;
  private embeddingLatency!: Histogram<string>;
  private storageLatency!: Histogram<string>;
  
  // Resource metrics
  private memoryUsage!: Gauge<string>;
  private vectorIndexSize!: Gauge<string>;
  private storageSize!: Gauge<string>;
  private activeConnections!: Gauge<string>;
  private cacheSize!: Gauge<string>;
  private cacheHitRate!: Gauge<string>;
  
  // Error metrics
  private errors!: Counter<string>;
  private circuitBreakerState!: Gauge<string>;
  private rateLimitExceeded!: Counter<string>;

  constructor(config: MetricsConfig = {}) {
    super();
    
    this.config = {
      prefix: config.prefix || 'claude_memory',
      defaultLabels: config.defaultLabels || {},
      enableDefaultMetrics: config.enableDefaultMetrics ?? true,
      gcDurationBuckets: config.gcDurationBuckets || [0.001, 0.01, 0.1, 1, 2, 5]
    };
    
    this.registry = new Registry();
    this.registry.setDefaultLabels(this.config.defaultLabels);
    
    this.initializeMetrics();
    
    if (this.config.enableDefaultMetrics) {
      this.enableDefaultMetrics();
    }
  }
  
  private initializeMetrics(): void {
    // Operation counters
    this.memoryCaptures = new Counter({
      name: `${this.config.prefix}_memory_captures_total`,
      help: 'Total number of memory capture operations',
      labelNames: ['event_type', 'status', 'workspace_id'],
      registers: [this.registry]
    });
    
    this.memoryRetrievals = new Counter({
      name: `${this.config.prefix}_memory_retrievals_total`,
      help: 'Total number of memory retrieval operations',
      labelNames: ['query_type', 'status', 'workspace_id'],
      registers: [this.registry]
    });
    
    this.contextBuilds = new Counter({
      name: `${this.config.prefix}_context_builds_total`,
      help: 'Total number of context build operations',
      labelNames: ['status', 'workspace_id'],
      registers: [this.registry]
    });
    
    this.hookExecutions = new Counter({
      name: `${this.config.prefix}_hook_executions_total`,
      help: 'Total number of hook executions',
      labelNames: ['hook_type', 'status'],
      registers: [this.registry]
    });
    
    // Performance metrics
    this.operationDuration = new Histogram({
      name: `${this.config.prefix}_operation_duration_seconds`,
      help: 'Duration of operations in seconds',
      labelNames: ['operation', 'status'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry]
    });
    
    this.queryLatency = new Summary({
      name: `${this.config.prefix}_query_latency_seconds`,
      help: 'Query latency in seconds',
      labelNames: ['query_type'],
      percentiles: [0.5, 0.9, 0.95, 0.99],
      registers: [this.registry]
    });
    
    this.embeddingLatency = new Histogram({
      name: `${this.config.prefix}_embedding_latency_seconds`,
      help: 'Embedding generation latency',
      labelNames: ['model'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry]
    });
    
    this.storageLatency = new Histogram({
      name: `${this.config.prefix}_storage_latency_seconds`,
      help: 'Storage operation latency',
      labelNames: ['operation', 'storage_type'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      registers: [this.registry]
    });
    
    // Resource gauges
    this.memoryUsage = new Gauge({
      name: `${this.config.prefix}_memory_usage_bytes`,
      help: 'Current memory usage in bytes',
      labelNames: ['type'],
      registers: [this.registry]
    });
    
    this.vectorIndexSize = new Gauge({
      name: `${this.config.prefix}_vector_index_size`,
      help: 'Number of vectors in the index',
      labelNames: ['index_type'],
      registers: [this.registry]
    });
    
    this.storageSize = new Gauge({
      name: `${this.config.prefix}_storage_size_bytes`,
      help: 'Storage size in bytes',
      labelNames: ['storage_type'],
      registers: [this.registry]
    });
    
    this.activeConnections = new Gauge({
      name: `${this.config.prefix}_active_connections`,
      help: 'Number of active connections',
      labelNames: ['connection_type'],
      registers: [this.registry]
    });
    
    this.cacheSize = new Gauge({
      name: `${this.config.prefix}_cache_size`,
      help: 'Number of items in cache',
      labelNames: ['cache_level'],
      registers: [this.registry]
    });
    
    this.cacheHitRate = new Gauge({
      name: `${this.config.prefix}_cache_hit_rate`,
      help: 'Cache hit rate (0-1)',
      labelNames: ['cache_level'],
      registers: [this.registry]
    });
    
    // Error metrics
    this.errors = new Counter({
      name: `${this.config.prefix}_errors_total`,
      help: 'Total number of errors',
      labelNames: ['operation', 'error_type'],
      registers: [this.registry]
    });
    
    this.circuitBreakerState = new Gauge({
      name: `${this.config.prefix}_circuit_breaker_state`,
      help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
      labelNames: ['breaker_name'],
      registers: [this.registry]
    });
    
    this.rateLimitExceeded = new Counter({
      name: `${this.config.prefix}_rate_limit_exceeded_total`,
      help: 'Number of rate limit exceeded events',
      labelNames: ['endpoint', 'workspace_id'],
      registers: [this.registry]
    });
  }
  
  private enableDefaultMetrics(): void {
    // Enable default Node.js metrics
    import('prom-client').then(client => {
      client.collectDefaultMetrics({
        register: this.registry,
        prefix: `${this.config.prefix}_nodejs_`,
        gcDurationBuckets: this.config.gcDurationBuckets
      });
    }).catch(error => {
      // Log error but don't fail initialization
      console.error('Failed to enable default metrics:', error);
    });
  }
  
  // Recording methods
  recordMemoryCapture(eventType: string, status: 'success' | 'error', workspaceId: string): void {
    this.memoryCaptures.inc({ event_type: eventType, status, workspace_id: workspaceId });
  }
  
  recordMemoryRetrieval(queryType: string, status: 'success' | 'error', workspaceId: string): void {
    this.memoryRetrievals.inc({ query_type: queryType, status, workspace_id: workspaceId });
  }
  
  recordContextBuild(status: 'success' | 'error', workspaceId: string): void {
    this.contextBuilds.inc({ status, workspace_id: workspaceId });
  }
  
  recordHookExecution(hookType: string, status: 'success' | 'error'): void {
    this.hookExecutions.inc({ hook_type: hookType, status });
  }
  
  recordOperationDuration(operation: string, duration: number, status: 'success' | 'error'): void {
    this.operationDuration.observe({ operation, status }, duration);
  }
  
  recordQueryLatency(queryType: string, latency: number): void {
    this.queryLatency.observe({ query_type: queryType }, latency);
  }
  
  recordEmbeddingLatency(model: string, latency: number): void {
    this.embeddingLatency.observe({ model }, latency);
  }
  
  recordStorageLatency(operation: string, storageType: string, latency: number): void {
    this.storageLatency.observe({ operation, storage_type: storageType }, latency);
  }
  
  setMemoryUsage(type: string, bytes: number): void {
    this.memoryUsage.set({ type }, bytes);
  }
  
  setVectorIndexSize(indexType: string, size: number): void {
    this.vectorIndexSize.set({ index_type: indexType }, size);
  }
  
  setStorageSize(storageType: string, bytes: number): void {
    this.storageSize.set({ storage_type: storageType }, bytes);
  }
  
  setActiveConnections(connectionType: string, count: number): void {
    this.activeConnections.set({ connection_type: connectionType }, count);
  }
  
  setCacheSize(cacheLevel: string, size: number): void {
    this.cacheSize.set({ cache_level: cacheLevel }, size);
  }
  
  setCacheHitRate(cacheLevel: string, rate: number): void {
    this.cacheHitRate.set({ cache_level: cacheLevel }, rate);
  }
  
  recordError(operation: string, errorType: string): void {
    this.errors.inc({ operation, error_type: errorType });
  }
  
  setCircuitBreakerState(breakerName: string, state: 0 | 1 | 2): void {
    this.circuitBreakerState.set({ breaker_name: breakerName }, state);
  }
  
  recordRateLimitExceeded(endpoint: string, workspaceId: string): void {
    this.rateLimitExceeded.inc({ endpoint, workspace_id: workspaceId });
  }
  
  // Timing utilities
  startTimer(operation: string) {
    const end = this.operationDuration.startTimer({ operation, status: 'pending' });
    return {
      end: (status: 'success' | 'error' = 'success') => {
        // Clear the pending metric and record with final status
        end({ operation, status });
      }
    };
  }
  
  // Registry access
  getRegistry(): Registry {
    return this.registry;
  }
  
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
  
  reset(): Promise<void> {
    this.registry.resetMetrics();
    return Promise.resolve();
  }
  
  // Utility methods for health and status
  getSystemMetrics(): Promise<{
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
    uptime: number;
  }> {
    return Promise.resolve({
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      uptime: process.uptime()
    });
  }
  
  // Update system metrics
  async updateSystemMetrics(): Promise<void> {
    const metrics = await this.getSystemMetrics();
    
    this.setMemoryUsage('heap_used', metrics.memoryUsage.heapUsed);
    this.setMemoryUsage('heap_total', metrics.memoryUsage.heapTotal);
    this.setMemoryUsage('rss', metrics.memoryUsage.rss);
    this.setMemoryUsage('external', metrics.memoryUsage.external);
  }
}