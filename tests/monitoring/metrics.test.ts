import { MetricsCollector } from '../../src/monitoring/metrics.js';
import { describe, test, expect, beforeEach, jest } from '@jest/globals';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;
  
  beforeEach(() => {
    metrics = new MetricsCollector({
      prefix: 'test',
      enableDefaultMetrics: false
    });
  });
  
  afterEach(async () => {
    await metrics.reset();
  });
  
  describe('initialization', () => {
    test('should create metrics collector with custom config', () => {
      const customMetrics = new MetricsCollector({
        prefix: 'custom',
        defaultLabels: { service: 'test' },
        enableDefaultMetrics: false
      });
      
      expect(customMetrics).toBeDefined();
    });
    
    test('should use default config when none provided', () => {
      const defaultMetrics = new MetricsCollector();
      expect(defaultMetrics).toBeDefined();
    });
  });
  
  describe('counter metrics', () => {
    test('should record memory capture events', () => {
      expect(() => {
        metrics.recordMemoryCapture('code_write', 'success', 'workspace-1');
        metrics.recordMemoryCapture('code_write', 'error', 'workspace-1');
      }).not.toThrow();
    });
    
    test('should record memory retrieval events', () => {
      expect(() => {
        metrics.recordMemoryRetrieval('semantic', 'success', 'workspace-1');
        metrics.recordMemoryRetrieval('filter', 'error', 'workspace-1');
      }).not.toThrow();
    });
    
    test('should record context build events', () => {
      expect(() => {
        metrics.recordContextBuild('success', 'workspace-1');
        metrics.recordContextBuild('error', 'workspace-1');
      }).not.toThrow();
    });
    
    test('should record hook execution events', () => {
      expect(() => {
        metrics.recordHookExecution('pre-commit', 'success');
        metrics.recordHookExecution('post-merge', 'error');
      }).not.toThrow();
    });
    
    test('should record error events', () => {
      expect(() => {
        metrics.recordError('storage_query', 'connection_timeout');
        metrics.recordError('embedding_generation', 'model_unavailable');
      }).not.toThrow();
    });
    
    test('should record rate limit events', () => {
      expect(() => {
        metrics.recordRateLimitExceeded('capture-memory', 'workspace-1');
      }).not.toThrow();
    });
  });
  
  describe('histogram metrics', () => {
    test('should record operation duration', () => {
      expect(() => {
        metrics.recordOperationDuration('memory_capture', 0.05, 'success');
        metrics.recordOperationDuration('memory_retrieve', 0.12, 'success');
        metrics.recordOperationDuration('context_build', 0.03, 'error');
      }).not.toThrow();
    });
    
    test('should record embedding latency', () => {
      expect(() => {
        metrics.recordEmbeddingLatency('sentence-transformers/all-MiniLM-L6-v2', 0.25);
        metrics.recordEmbeddingLatency('sentence-transformers/all-mpnet-base-v2', 0.45);
      }).not.toThrow();
    });
    
    test('should record storage latency', () => {
      expect(() => {
        metrics.recordStorageLatency('read', 'sqlite', 0.005);
        metrics.recordStorageLatency('write', 'vector_store', 0.015);
      }).not.toThrow();
    });
  });
  
  describe('summary metrics', () => {
    test('should record query latency', () => {
      expect(() => {
        metrics.recordQueryLatency('semantic_search', 0.08);
        metrics.recordQueryLatency('filtered_query', 0.02);
      }).not.toThrow();
    });
  });
  
  describe('gauge metrics', () => {
    test('should set memory usage', () => {
      expect(() => {
        metrics.setMemoryUsage('heap_used', 1024 * 1024 * 50); // 50MB
        metrics.setMemoryUsage('heap_total', 1024 * 1024 * 100); // 100MB
        metrics.setMemoryUsage('rss', 1024 * 1024 * 75); // 75MB
      }).not.toThrow();
    });
    
    test('should set vector index size', () => {
      expect(() => {
        metrics.setVectorIndexSize('hnsw', 1000);
        metrics.setVectorIndexSize('flat', 500);
      }).not.toThrow();
    });
    
    test('should set storage size', () => {
      expect(() => {
        metrics.setStorageSize('sqlite', 1024 * 1024 * 10); // 10MB
        metrics.setStorageSize('vector_store', 1024 * 1024 * 5); // 5MB
      }).not.toThrow();
    });
    
    test('should set active connections', () => {
      expect(() => {
        metrics.setActiveConnections('database', 5);
        metrics.setActiveConnections('cache', 3);
      }).not.toThrow();
    });
    
    test('should set cache metrics', () => {
      expect(() => {
        metrics.setCacheSize('L1', 100);
        metrics.setCacheSize('L2', 500);
        metrics.setCacheHitRate('L1', 0.85);
        metrics.setCacheHitRate('L2', 0.92);
      }).not.toThrow();
    });
    
    test('should set circuit breaker state', () => {
      expect(() => {
        metrics.setCircuitBreakerState('hook_executor', 0); // closed
        metrics.setCircuitBreakerState('storage_connection', 1); // open
      }).not.toThrow();
    });
  });
  
  describe('timing utilities', () => {
    test('should provide timer functionality', (done) => {
      const timer = metrics.startTimer('test_operation');
      
      setTimeout(() => {
        const duration = timer.end('success');
        expect(duration).toBeUndefined(); // Timer doesn't return duration
        done();
      }, 10);
    });
  });
  
  describe('system metrics', () => {
    test('should update system metrics', async () => {
      await expect(metrics.updateSystemMetrics()).resolves.not.toThrow();
    });
    
    test('should get system metrics', async () => {
      const systemMetrics = await metrics.getSystemMetrics();
      
      expect(systemMetrics).toHaveProperty('memoryUsage');
      expect(systemMetrics).toHaveProperty('cpuUsage');
      expect(systemMetrics).toHaveProperty('uptime');
      
      expect(systemMetrics.memoryUsage).toHaveProperty('heapUsed');
      expect(systemMetrics.memoryUsage).toHaveProperty('heapTotal');
      expect(systemMetrics.memoryUsage).toHaveProperty('rss');
      
      expect(systemMetrics.cpuUsage).toHaveProperty('user');
      expect(systemMetrics.cpuUsage).toHaveProperty('system');
      
      expect(typeof systemMetrics.uptime).toBe('number');
    });
  });
  
  describe('metrics export', () => {
    test('should export metrics in Prometheus format', async () => {
      // Record some test metrics
      metrics.recordMemoryCapture('test_event', 'success', 'test-workspace');
      metrics.recordOperationDuration('test_op', 0.1, 'success');
      metrics.setMemoryUsage('test_type', 1024);
      
      const metricsOutput = await metrics.getMetrics();
      
      expect(typeof metricsOutput).toBe('string');
      expect(metricsOutput.length).toBeGreaterThan(0);
      
      // Should contain our custom metrics
      expect(metricsOutput).toContain('test_memory_captures_total');
      expect(metricsOutput).toContain('test_operation_duration_seconds');
      expect(metricsOutput).toContain('test_memory_usage_bytes');
    });
    
    test('should get registry instance', () => {
      const registry = metrics.getRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.metrics).toBe('function');
    });
  });
  
  describe('metrics reset', () => {
    test('should reset all metrics', async () => {
      // Record some metrics
      metrics.recordMemoryCapture('test_event', 'success', 'test-workspace');
      metrics.setMemoryUsage('test_type', 1024);
      
      // Reset metrics
      await metrics.reset();
      
      // Metrics should be cleared
      const metricsOutput = await metrics.getMetrics();
      expect(metricsOutput).toBe('');
    });
  });
});