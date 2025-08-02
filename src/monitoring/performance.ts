import { performance } from 'perf_hooks';
import { EventEmitter } from 'events';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count' | 'rate';
  timestamp: Date;
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface TimingResult {
  duration: number;
  end: (labels?: Record<string, string>) => void;
}

export interface BenchmarkResult {
  name: string;
  duration: number;
  iterations: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p50: number;
  p95: number;
  p99: number;
  throughput: number; // operations per second
}

export class PerformanceTracker extends EventEmitter {
  private activeTimers: Map<string, number> = new Map();
  private metrics: PerformanceMetric[] = [];
  private maxMetricsHistory = 10000;
  private benchmarkHistory: Map<string, number[]> = new Map();
  
  // Start timing an operation
  startTiming(operationName: string, labels?: Record<string, string>): TimingResult {
    const startTime = performance.now();
    const timerId = `${operationName}_${Date.now()}_${Math.random()}`;
    
    this.activeTimers.set(timerId, startTime);
    
    return {
      duration: 0, // Will be calculated on end
      end: (endLabels?: Record<string, string>) => {
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        this.activeTimers.delete(timerId);
        
        const metric: PerformanceMetric = {
          name: operationName,
          value: duration,
          unit: 'ms',
          timestamp: new Date(),
          labels: { ...labels, ...endLabels }
        };
        
        this.recordMetric(metric);
        return duration;
      }
    };
  }
  
  // Time a function execution
  async timeAsync<T>(
    operationName: string,
    fn: () => Promise<T>,
    labels?: Record<string, string>
  ): Promise<{ result: T; duration: number }> {
    const startTime = performance.now();
    
    try {
      const result = await fn();
      const duration = performance.now() - startTime;
      
      const metric: PerformanceMetric = {
        name: operationName,
        value: duration,
        unit: 'ms',
        timestamp: new Date(),
        labels: { ...labels, status: 'success' }
      };
      
      this.recordMetric(metric);
      return { result, duration };
    } catch (error) {
      const duration = performance.now() - startTime;
      
      const metric: PerformanceMetric = {
        name: operationName,
        value: duration,
        unit: 'ms',
        timestamp: new Date(),
        labels: { ...labels, status: 'error' }
      };
      
      this.recordMetric(metric);
      throw error;
    }
  }
  
  // Time a synchronous function execution
  timeSync<T>(
    operationName: string,
    fn: () => T,
    labels?: Record<string, string>
  ): { result: T; duration: number } {
    const startTime = performance.now();
    
    try {
      const result = fn();
      const duration = performance.now() - startTime;
      
      const metric: PerformanceMetric = {
        name: operationName,
        value: duration,
        unit: 'ms',
        timestamp: new Date(),
        labels: { ...labels, status: 'success' }
      };
      
      this.recordMetric(metric);
      return { result, duration };
    } catch (error) {
      const duration = performance.now() - startTime;
      
      const metric: PerformanceMetric = {
        name: operationName,
        value: duration,
        unit: 'ms',
        timestamp: new Date(),
        labels: { ...labels, status: 'error' }
      };
      
      this.recordMetric(metric);
      throw error;
    }
  }
  
  // Record a custom metric
  recordMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    
    // Maintain history limit
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }
    
    // Emit event for real-time monitoring
    this.emit('metric', metric);
    
    // Log slow operations
    if (metric.unit === 'ms' && metric.value > 1000) {
      this.emit('slowOperation', metric);
    }
  }
  
  // Record memory usage
  recordMemoryUsage(operationName: string, labels?: Record<string, string>): void {
    const memUsage = process.memoryUsage();
    
    this.recordMetric({
      name: `${operationName}_memory_heap_used`,
      value: memUsage.heapUsed,
      unit: 'bytes',
      timestamp: new Date(),
      labels
    });
    
    this.recordMetric({
      name: `${operationName}_memory_heap_total`,
      value: memUsage.heapTotal,
      unit: 'bytes',
      timestamp: new Date(),
      labels
    });
    
    this.recordMetric({
      name: `${operationName}_memory_rss`,
      value: memUsage.rss,
      unit: 'bytes',
      timestamp: new Date(),
      labels
    });
  }
  
  // Benchmark a function with multiple iterations
  async benchmarkAsync<T>(
    name: string,
    fn: () => Promise<T>,
    options: {
      iterations?: number;
      warmupIterations?: number;
      labels?: Record<string, string>;
    } = {}
  ): Promise<BenchmarkResult> {
    const iterations = options.iterations || 100;
    const warmupIterations = options.warmupIterations || 10;
    const durations: number[] = [];
    
    // Warmup runs
    for (let i = 0; i < warmupIterations; i++) {
      await fn();
    }
    
    // Benchmark runs
    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();
      await fn();
      const duration = performance.now() - startTime;
      durations.push(duration);
    }
    
    return this.calculateBenchmarkResult(name, durations);
  }
  
  // Benchmark a synchronous function
  benchmarkSync<T>(
    name: string,
    fn: () => T,
    options: {
      iterations?: number;
      warmupIterations?: number;
      labels?: Record<string, string>;
    } = {}
  ): BenchmarkResult {
    const iterations = options.iterations || 100;
    const warmupIterations = options.warmupIterations || 10;
    const durations: number[] = [];
    
    // Warmup runs
    for (let i = 0; i < warmupIterations; i++) {
      fn();
    }
    
    // Benchmark runs
    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();
      fn();
      const duration = performance.now() - startTime;
      durations.push(duration);
    }
    
    return this.calculateBenchmarkResult(name, durations);
  }
  
  private calculateBenchmarkResult(name: string, durations: number[]): BenchmarkResult {
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const avgDuration = totalDuration / durations.length;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);
    
    const p50 = this.percentile(sortedDurations, 0.5);
    const p95 = this.percentile(sortedDurations, 0.95);
    const p99 = this.percentile(sortedDurations, 0.99);
    
    const throughput = durations.length / (totalDuration / 1000); // ops per second
    
    const result: BenchmarkResult = {
      name,
      duration: totalDuration,
      iterations: durations.length,
      avgDuration,
      minDuration,
      maxDuration,
      p50,
      p95,
      p99,
      throughput
    };
    
    // Store in history
    this.benchmarkHistory.set(name, durations);
    
    // Emit benchmark result
    this.emit('benchmark', result);
    
    return result;
  }
  
  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)] || 0;
  }
  
  // Get performance statistics
  getPerformanceStats(operationName?: string): {
    totalMetrics: number;
    operationCount: Record<string, number>;
    avgDuration: Record<string, number>;
    slowOperations: PerformanceMetric[];
  } {
    const filteredMetrics = operationName 
      ? this.metrics.filter(m => m.name === operationName)
      : this.metrics;
    
    const operationCount: Record<string, number> = {};
    const totalDurations: Record<string, number> = {};
    const slowOperations: PerformanceMetric[] = [];
    
    for (const metric of filteredMetrics) {
      operationCount[metric.name] = (operationCount[metric.name] || 0) + 1;
      
      if (metric.unit === 'ms') {
        totalDurations[metric.name] = (totalDurations[metric.name] || 0) + metric.value;
        
        if (metric.value > 1000) { // > 1 second
          slowOperations.push(metric);
        }
      }
    }
    
    const avgDuration: Record<string, number> = {};
    for (const [name, total] of Object.entries(totalDurations)) {
      avgDuration[name] = total / (operationCount[name] || 1);
    }
    
    return {
      totalMetrics: filteredMetrics.length,
      operationCount,
      avgDuration,
      slowOperations: slowOperations.slice(-10) // Last 10 slow operations
    };
  }
  
  // Get recent metrics
  getRecentMetrics(limit: number = 100): PerformanceMetric[] {
    return this.metrics.slice(-limit).reverse();
  }
  
  // Get metrics by time range
  getMetricsByTimeRange(
    startTime: Date,
    endTime: Date,
    operationName?: string
  ): PerformanceMetric[] {
    return this.metrics.filter(metric => {
      const matchesTime = metric.timestamp >= startTime && metric.timestamp <= endTime;
      const matchesOperation = !operationName || metric.name === operationName;
      return matchesTime && matchesOperation;
    });
  }
  
  // Get benchmark history
  getBenchmarkHistory(name?: string): Map<string, number[]> | number[] | undefined {
    if (name) {
      return this.benchmarkHistory.get(name);
    }
    return this.benchmarkHistory;
  }
  
  // Clear old metrics to free memory
  clearOldMetrics(olderThan: Date): number {
    const initialCount = this.metrics.length;
    this.metrics = this.metrics.filter(metric => metric.timestamp >= olderThan);
    return initialCount - this.metrics.length;
  }
  
  // Memory pressure monitoring
  startMemoryPressureMonitoring(intervalMs: number = 30000): void {
    const checkMemoryPressure = () => {
      const usage = process.memoryUsage();
      const usagePercent = usage.heapUsed / usage.heapTotal;
      
      this.recordMetric({
        name: 'memory_pressure',
        value: usagePercent,
        unit: 'rate',
        timestamp: new Date(),
        metadata: {
          heapUsed: usage.heapUsed,
          heapTotal: usage.heapTotal,
          rss: usage.rss,
          external: usage.external
        }
      });
      
      // Emit high memory pressure events
      if (usagePercent > 0.8) {
        this.emit('memoryPressure', {
          level: usagePercent > 0.9 ? 'critical' : 'high',
          usage,
          usagePercent
        });
      }
    };
    
    // Initial check
    checkMemoryPressure();
    
    // Periodic checks
    setInterval(checkMemoryPressure, intervalMs);
  }
  
  // CPU monitoring
  startCPUMonitoring(intervalMs: number = 30000): void {
    let lastCpuUsage = process.cpuUsage();
    
    const checkCPUUsage = () => {
      const currentCpuUsage = process.cpuUsage(lastCpuUsage);
      lastCpuUsage = process.cpuUsage();
      
      const userPercent = (currentCpuUsage.user / 1000000) / (intervalMs / 1000) * 100;
      const systemPercent = (currentCpuUsage.system / 1000000) / (intervalMs / 1000) * 100;
      const totalPercent = userPercent + systemPercent;
      
      this.recordMetric({
        name: 'cpu_usage_user',
        value: userPercent,
        unit: 'rate',
        timestamp: new Date()
      });
      
      this.recordMetric({
        name: 'cpu_usage_system',
        value: systemPercent,
        unit: 'rate',
        timestamp: new Date()
      });
      
      this.recordMetric({
        name: 'cpu_usage_total',
        value: totalPercent,
        unit: 'rate',
        timestamp: new Date()
      });
      
      // Emit high CPU usage events
      if (totalPercent > 80) {
        this.emit('highCPUUsage', {
          level: totalPercent > 95 ? 'critical' : 'high',
          userPercent,
          systemPercent,
          totalPercent
        });
      }
    };
    
    // Start monitoring after first interval
    setTimeout(() => {
      checkCPUUsage();
      setInterval(checkCPUUsage, intervalMs);
    }, intervalMs);
  }
}

// Singleton instance for global performance tracking
export const globalPerformanceTracker = new PerformanceTracker();