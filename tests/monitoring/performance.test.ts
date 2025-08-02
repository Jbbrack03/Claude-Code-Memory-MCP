import { PerformanceTracker } from '../../src/monitoring/performance.js';
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('PerformanceTracker', () => {
  let tracker: PerformanceTracker;
  
  beforeEach(() => {
    tracker = new PerformanceTracker();
  });
  
  afterEach(() => {
    // Clean up any listeners
    tracker.removeAllListeners();
  });
  
  describe('timing operations', () => {
    test('should time async operations', async () => {
      const mockAsyncOperation = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('result'), 50))
      );
      
      const { result, duration } = await tracker.timeAsync('test_async_op', mockAsyncOperation);
      
      expect(result).toBe('result');
      expect(duration).toBeGreaterThan(40); // Should be around 50ms
      expect(duration).toBeLessThan(100);
      expect(mockAsyncOperation).toHaveBeenCalled();
    });
    
    test('should time async operations with labels', async () => {
      const mockAsyncOperation = jest.fn().mockResolvedValue('labeled_result');
      
      const { result, duration } = await tracker.timeAsync(
        'labeled_async_op',
        mockAsyncOperation,
        { component: 'storage', action: 'read' }
      );
      
      expect(result).toBe('labeled_result');
      expect(duration).toBeGreaterThan(0);
    });
    
    test('should handle async operation errors', async () => {
      const mockFailingOperation = jest.fn().mockRejectedValue(new Error('Operation failed'));
      
      await expect(
        tracker.timeAsync('failing_async_op', mockFailingOperation)
      ).rejects.toThrow('Operation failed');
      
      expect(mockFailingOperation).toHaveBeenCalled();
    });
    
    test('should time synchronous operations', () => {
      const mockSyncOperation = jest.fn().mockImplementation(() => {
        // Simulate some work
        let sum = 0;
        for (let i = 0; i < 1000; i++) {
          sum += i;
        }
        return sum;
      });
      
      const { result, duration } = tracker.timeSync('test_sync_op', mockSyncOperation);
      
      expect(result).toBe(499500); // Sum of 0 to 999
      expect(duration).toBeGreaterThan(0);
      expect(mockSyncOperation).toHaveBeenCalled();
    });
    
    test('should handle synchronous operation errors', () => {
      const mockFailingOperation = jest.fn().mockImplementation(() => {
        throw new Error('Sync operation failed');
      });
      
      expect(() => {
        tracker.timeSync('failing_sync_op', mockFailingOperation);
      }).toThrow('Sync operation failed');
      
      expect(mockFailingOperation).toHaveBeenCalled();
    });
  });
  
  describe('manual timing', () => {
    test('should provide manual timing interface', (done) => {
      const timer = tracker.startTiming('manual_operation', { type: 'manual' });
      
      setTimeout(() => {
        timer.end({ status: 'completed' });
        done();
      }, 10);
    });
    
    test('should track multiple concurrent timers', () => {
      const timer1 = tracker.startTiming('operation_1');
      const timer2 = tracker.startTiming('operation_2');
      const timer3 = tracker.startTiming('operation_3');
      
      // All timers should be independent
      expect(timer1).toBeDefined();
      expect(timer2).toBeDefined();
      expect(timer3).toBeDefined();
      
      timer1.end();
      timer2.end();
      timer3.end();
    });
  });
  
  describe('benchmarking', () => {
    test('should benchmark async operations', async () => {
      const mockOperation = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('benchmark_result'), 1))
      );
      
      const result = await tracker.benchmarkAsync('async_benchmark', mockOperation, {
        iterations: 10,
        warmupIterations: 2
      });
      
      expect(result.name).toBe('async_benchmark');
      expect(result.iterations).toBe(10);
      expect(result.avgDuration).toBeGreaterThan(0);
      expect(result.minDuration).toBeGreaterThan(0);
      expect(result.maxDuration).toBeGreaterThan(0);
      expect(result.p50).toBeGreaterThan(0);
      expect(result.p95).toBeGreaterThan(0);
      expect(result.p99).toBeGreaterThan(0);
      expect(result.throughput).toBeGreaterThan(0);
      
      // Should have called warmup + benchmark iterations
      expect(mockOperation).toHaveBeenCalledTimes(12); // 2 warmup + 10 benchmark
    });
    
    test('should benchmark sync operations', () => {
      const mockOperation = jest.fn().mockImplementation(() => {
        // Simulate work
        let result = 0;
        for (let i = 0; i < 100; i++) {
          result += Math.sqrt(i);
        }
        return result;
      });
      
      const result = tracker.benchmarkSync('sync_benchmark', mockOperation, {
        iterations: 5,
        warmupIterations: 1
      });
      
      expect(result.name).toBe('sync_benchmark');
      expect(result.iterations).toBe(5);
      expect(result.avgDuration).toBeGreaterThan(0);
      expect(result.throughput).toBeGreaterThan(0);
      
      // Should have called warmup + benchmark iterations
      expect(mockOperation).toHaveBeenCalledTimes(6); // 1 warmup + 5 benchmark
    });
    
    test('should use default benchmark options', async () => {
      const mockOperation = jest.fn().mockResolvedValue('default_benchmark');
      
      const result = await tracker.benchmarkAsync('default_options_benchmark', mockOperation);
      
      expect(result.iterations).toBe(100); // Default iterations
      
      // Should have called warmup + benchmark iterations
      expect(mockOperation).toHaveBeenCalledTimes(110); // 10 warmup + 100 benchmark
    });
  });
  
  describe('metric recording', () => {
    test('should record custom metrics', () => {
      const metric = {
        name: 'custom_metric',
        value: 42,
        unit: 'count' as const,
        timestamp: new Date(),
        labels: { component: 'test' }
      };
      
      expect(() => {
        tracker.recordMetric(metric);
      }).not.toThrow();
    });
    
    test('should record memory usage metrics', () => {
      expect(() => {
        tracker.recordMemoryUsage('test_operation', { component: 'storage' });
      }).not.toThrow();
    });
    
    test('should emit slow operation events', (done) => {
      tracker.on('slowOperation', (metric) => {
        expect(metric.name).toBe('slow_operation');
        expect(metric.value).toBeGreaterThan(1000);
        done();
      });
      
      tracker.recordMetric({
        name: 'slow_operation',
        value: 1500, // 1.5 seconds
        unit: 'ms',
        timestamp: new Date()
      });
    });
    
    test('should emit benchmark events', (done) => {
      tracker.on('benchmark', (result) => {
        expect(result.name).toBe('event_benchmark');
        expect(result.iterations).toBe(1);
        done();
      });
      
      const mockOperation = jest.fn().mockResolvedValue('event_result');
      tracker.benchmarkAsync('event_benchmark', mockOperation, { iterations: 1 });
    });
  });
  
  describe('performance statistics', () => {
    test('should get performance statistics', () => {
      // Record some test metrics
      tracker.recordMetric({
        name: 'test_operation',
        value: 50,
        unit: 'ms',
        timestamp: new Date()
      });
      
      tracker.recordMetric({
        name: 'test_operation',
        value: 75,
        unit: 'ms',
        timestamp: new Date()
      });
      
      tracker.recordMetric({
        name: 'slow_test_operation',
        value: 1200, // Slow operation
        unit: 'ms',
        timestamp: new Date()
      });
      
      const stats = tracker.getPerformanceStats();
      
      expect(stats.totalMetrics).toBe(3);
      expect(stats.operationCount['test_operation']).toBe(2);
      expect(stats.operationCount['slow_test_operation']).toBe(1);
      expect(stats.avgDuration['test_operation']).toBe(62.5); // (50 + 75) / 2
      expect(stats.slowOperations).toHaveLength(1);
      expect(stats.slowOperations[0].name).toBe('slow_test_operation');
    });
    
    test('should get statistics for specific operation', () => {
      tracker.recordMetric({
        name: 'specific_operation',
        value: 100,
        unit: 'ms',
        timestamp: new Date()
      });
      
      tracker.recordMetric({
        name: 'other_operation',
        value: 200,
        unit: 'ms',
        timestamp: new Date()
      });
      
      const stats = tracker.getPerformanceStats('specific_operation');
      
      expect(stats.totalMetrics).toBe(1);
      expect(stats.operationCount['specific_operation']).toBe(1);
      expect(stats.operationCount['other_operation']).toBeUndefined();
    });
    
    test('should get recent metrics', () => {
      // Record multiple metrics
      for (let i = 0; i < 150; i++) {
        tracker.recordMetric({
          name: `operation_${i}`,
          value: i,
          unit: 'ms',
          timestamp: new Date()
        });
      }
      
      const recentMetrics = tracker.getRecentMetrics(50);
      expect(recentMetrics).toHaveLength(50);
      
      // Should be the most recent ones (highest indices)
      expect(recentMetrics[0].name).toBe('operation_149');
      expect(recentMetrics[49].name).toBe('operation_100');
    });
    
    test('should get metrics by time range', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      
      // Record metrics at different times
      tracker.recordMetric({
        name: 'old_operation',
        value: 100,
        unit: 'ms',
        timestamp: twoHoursAgo
      });
      
      tracker.recordMetric({
        name: 'recent_operation',
        value: 200,
        unit: 'ms',
        timestamp: now
      });
      
      const recentMetrics = tracker.getMetricsByTimeRange(oneHourAgo, now);
      
      expect(recentMetrics).toHaveLength(1);
      expect(recentMetrics[0].name).toBe('recent_operation');
    });
  });
  
  describe('benchmark history', () => {
    test('should store benchmark history', async () => {
      const mockOperation = jest.fn().mockResolvedValue('history_result');
      
      await tracker.benchmarkAsync('history_benchmark', mockOperation, {
        iterations: 3,
        warmupIterations: 1
      });
      
      const history = tracker.getBenchmarkHistory('history_benchmark');
      expect(history).toHaveLength(3);
      expect(history).toEqual(expect.arrayContaining([
        expect.any(Number),
        expect.any(Number),
        expect.any(Number)
      ]));
    });
    
    test('should get all benchmark history', async () => {
      const mockOp1 = jest.fn().mockResolvedValue('result1');
      const mockOp2 = jest.fn().mockResolvedValue('result2');
      
      await tracker.benchmarkAsync('benchmark_1', mockOp1, { iterations: 2, warmupIterations: 0 });
      await tracker.benchmarkAsync('benchmark_2', mockOp2, { iterations: 2, warmupIterations: 0 });
      
      const allHistory = tracker.getBenchmarkHistory();
      
      expect(allHistory).toBeInstanceOf(Map);
      expect(allHistory.has('benchmark_1')).toBe(true);
      expect(allHistory.has('benchmark_2')).toBe(true);
    });
  });
  
  describe('memory management', () => {
    test('should clear old metrics', () => {
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      const recentDate = new Date();
      
      // Record old and recent metrics
      tracker.recordMetric({
        name: 'old_metric',
        value: 100,
        unit: 'ms',
        timestamp: oldDate
      });
      
      tracker.recordMetric({
        name: 'recent_metric',
        value: 200,
        unit: 'ms',
        timestamp: recentDate
      });
      
      const cutoffDate = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12 hours ago
      const clearedCount = tracker.clearOldMetrics(cutoffDate);
      
      expect(clearedCount).toBe(1); // Should have cleared the old metric
      
      const recentMetrics = tracker.getRecentMetrics();
      expect(recentMetrics).toHaveLength(1);
      expect(recentMetrics[0].name).toBe('recent_metric');
    });
  });
  
  describe('system monitoring', () => {
    test('should start memory pressure monitoring', (done) => {
      // Mock high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn().mockReturnValue({
        heapUsed: 910 * 1024 * 1024, // 910MB
        heapTotal: 1000 * 1024 * 1024, // 1GB (91% usage)
        rss: 1100 * 1024 * 1024,
        external: 50 * 1024 * 1024
      });
      
      // Set up timeout to avoid hanging test
      const timeout = setTimeout(() => {
        process.memoryUsage = originalMemoryUsage;
        done(new Error('Memory pressure event not received within timeout'));
      }, 1000);
      
      let intervalId: NodeJS.Timeout;
      tracker.on('memoryPressure', (event) => {
        clearTimeout(timeout);
        expect(event.level).toBe('critical');
        expect(event.usagePercent).toBe(0.91);
        
        // Clean up interval to prevent Jest hang
        if (intervalId) clearInterval(intervalId);
        
        // Restore original function
        process.memoryUsage = originalMemoryUsage;
        done();
      });
      
      // Store interval ID to clean up if needed
      const originalSetInterval = setInterval;
      setInterval = jest.fn().mockImplementation((fn, ms) => {
        intervalId = originalSetInterval(fn, ms);
        return intervalId;
      });
      
      tracker.startMemoryPressureMonitoring(10); // Very short interval for testing
      
      // Restore setInterval
      setInterval = originalSetInterval;
    });
    
    test('should start CPU monitoring', (done) => {
      let callCount = 0;
      
      tracker.on('metric', (metric) => {
        if (metric.name.startsWith('cpu_usage')) {
          callCount++;
          
          // After receiving all 3 CPU metrics (user, system, total)
          if (callCount === 3) {
            expect(['cpu_usage_user', 'cpu_usage_system', 'cpu_usage_total']).toContain(metric.name);
            expect(metric.unit).toBe('rate');
            done();
          }
        }
      });
      
      tracker.startCPUMonitoring(50); // Short interval for testing
    }, 10000);
  });
});