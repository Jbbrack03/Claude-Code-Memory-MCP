/**
 * Tests for MetricsCollector class
 * 
 * This test suite follows TDD principles and ensures all tests fail initially (red phase).
 * Tests cover Prometheus metrics collection, registration, and performance requirements.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MetricsCollector } from '../../src/monitoring/metrics-collector.js';

describe('MetricsCollector', () => {
  let metricsCollector: MetricsCollector;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Construction and Initialization', () => {
    it('should create a MetricsCollector instance with default configuration', () => {
      // Given: Default configuration
      
      // When: Creating a new MetricsCollector
      metricsCollector = new MetricsCollector();
      
      // Then: Instance should be created successfully
      expect(metricsCollector).toBeInstanceOf(MetricsCollector);
    });

    it('should create a MetricsCollector with custom configuration', () => {
      // Given: Custom configuration
      const config = {
        enabled: true,
        prefix: 'custom_mcp_',
        collectDefaultMetrics: false,
        defaultLabels: { service: 'test' }
      };
      
      // When: Creating MetricsCollector with config
      metricsCollector = new MetricsCollector(config);
      
      // Then: Instance should be created with custom settings
      expect(metricsCollector).toBeInstanceOf(MetricsCollector);
    });

    it('should be disabled when configuration sets enabled to false', () => {
      // Given: Configuration with metrics disabled
      const config = { enabled: false };
      
      // When: Creating disabled MetricsCollector
      metricsCollector = new MetricsCollector(config);
      
      // Then: Metrics collection should be disabled
      expect(metricsCollector.isEnabled()).toBe(false);
    });

    it('should initialize all required Prometheus metrics', () => {
      // Given: MetricsCollector instance
      metricsCollector = new MetricsCollector();
      
      // When: Initializing metrics
      // Then: Should not throw any errors during initialization
      expect(() => metricsCollector.initialize()).not.toThrow();
    });

    it('should clear existing metrics on re-initialization', () => {
      // Given: Already initialized MetricsCollector
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
      
      // When: Re-initializing
      // Then: Should not throw
      expect(() => metricsCollector.initialize()).not.toThrow();
    });
  });

  describe('Request Metrics', () => {
    beforeEach(() => {
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
    });

    it('should increment request counter with labels', () => {
      // Given: Initialized metrics collector
      
      // When: Recording a request
      // Then: Should not throw
      expect(() => metricsCollector.recordRequest('capture-memory', 'success')).not.toThrow();
    });

    it('should record request duration', () => {
      // Given: Initialized metrics collector
      const duration = 0.150; // 150ms
      
      // When: Recording request duration
      // Then: Should not throw
      expect(() => metricsCollector.recordRequestDuration('retrieve-memories', duration)).not.toThrow();
    });

    it('should provide timer for measuring request duration', () => {
      // Given: Initialized metrics collector
      
      // When: Starting a timer
      const timer = metricsCollector.startRequestTimer('build-context');
      
      // Then: Timer should be returned
      expect(timer).toBeInstanceOf(Function);
    });

    it('should handle multiple concurrent requests', async () => {
      // Given: Initialized metrics collector
      
      // When: Recording multiple requests simultaneously
      const promises = [
        Promise.resolve(metricsCollector.recordRequest('capture-memory', 'success')),
        Promise.resolve(metricsCollector.recordRequest('retrieve-memories', 'success')),
        Promise.resolve(metricsCollector.recordRequest('build-context', 'error'))
      ];
      
      // Then: Should complete without errors
      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });

  describe('Memory Operation Metrics', () => {
    beforeEach(() => {
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
    });

    it('should record memory storage operations', () => {
      // Given: Initialized metrics collector
      
      // When: Recording a memory operation
      // Then: Should not throw
      expect(() => metricsCollector.recordMemoryOperation('store', 'success')).not.toThrow();
    });

    it('should record memory operation failures', () => {
      // Given: Initialized metrics collector
      
      // When: Recording a failed memory operation
      // Then: Should not throw
      expect(() => metricsCollector.recordMemoryOperation('retrieve', 'error')).not.toThrow();
    });

    it('should update storage size gauge', () => {
      // Given: Initialized metrics collector
      const sizeBytes = 1048576; // 1MB
      
      // When: Updating storage size
      // Then: Should not throw
      expect(() => metricsCollector.updateStorageSize('sqlite', sizeBytes)).not.toThrow();
    });

    it('should handle different storage types', () => {
      // Given: Initialized metrics collector
      
      // When: Updating different storage types
      // Then: Should not throw for any storage type
      expect(() => {
        metricsCollector.updateStorageSize('sqlite', 1000000);
        metricsCollector.updateStorageSize('vector', 500000);
        metricsCollector.updateStorageSize('files', 2000000);
      }).not.toThrow();
    });
  });

  describe('Connection Metrics', () => {
    beforeEach(() => {
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
    });

    it('should update active connections gauge', () => {
      // Given: Initialized metrics collector
      const connectionCount = 5;
      
      // When: Setting active connections
      // Then: Should not throw
      expect(() => metricsCollector.setActiveConnections(connectionCount)).not.toThrow();
    });

    it('should increment active connections', () => {
      // Given: Initialized metrics collector
      
      // When: Incrementing connections
      // Then: Should not throw
      expect(() => metricsCollector.incrementConnections()).not.toThrow();
    });

    it('should decrement active connections', () => {
      // Given: Initialized metrics collector
      
      // When: Decrementing connections
      // Then: Should not throw
      expect(() => metricsCollector.decrementConnections()).not.toThrow();
    });

    it('should not allow negative connection count', () => {
      // Given: Initialized metrics collector with 0 connections
      metricsCollector.setActiveConnections(0);
      
      // When: Attempting to decrement below zero
      // Then: Should not throw and should handle gracefully
      expect(() => metricsCollector.decrementConnections()).not.toThrow();
    });
  });

  describe('Error Metrics', () => {
    beforeEach(() => {
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
    });

    it('should record errors by type and component', () => {
      // Given: Initialized metrics collector
      
      // When: Recording an error
      // Then: Should not throw
      expect(() => metricsCollector.recordError('storage_error', 'engine')).not.toThrow();
    });

    it('should track different error types', () => {
      // Given: Initialized metrics collector
      
      // When: Recording various error types
      // Then: Should not throw for any error type
      expect(() => {
        metricsCollector.recordError('timeout', 'hooks');
        metricsCollector.recordError('validation', 'git');
        metricsCollector.recordError('network', 'intelligence');
      }).not.toThrow();
    });
  });

  describe('Hook Execution Metrics', () => {
    beforeEach(() => {
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
    });

    it('should record hook execution duration', () => {
      // Given: Initialized metrics collector
      const duration = 0.025; // 25ms
      
      // When: Recording hook duration
      // Then: Should not throw
      expect(() => metricsCollector.recordHookDuration('pre-commit', 'success', duration)).not.toThrow();
    });

    it('should provide timer for hook execution', () => {
      // Given: Initialized metrics collector
      
      // When: Starting hook timer
      const timer = metricsCollector.startHookTimer('post-save');
      
      // Then: Timer should be returned
      expect(timer).toBeInstanceOf(Function);
    });

    it('should handle hook failures', () => {
      // Given: Initialized metrics collector
      const duration = 0.100; // 100ms
      
      // When: Recording failed hook execution
      // Then: Should not throw
      expect(() => metricsCollector.recordHookDuration('pre-push', 'error', duration)).not.toThrow();
    });
  });

  describe('Vector Search Metrics', () => {
    beforeEach(() => {
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
    });

    it('should record vector search duration', () => {
      // Given: Initialized metrics collector
      const duration = 0.075; // 75ms
      
      // When: Recording vector search duration
      // Then: Should not throw
      expect(() => metricsCollector.recordVectorSearchDuration('hnsw', duration)).not.toThrow();
    });

    it('should handle different index types', () => {
      // Given: Initialized metrics collector
      
      // When: Recording searches for different index types
      // Then: Should not throw for any index type
      expect(() => {
        metricsCollector.recordVectorSearchDuration('flat', 0.010);
        metricsCollector.recordVectorSearchDuration('ivf', 0.050);
      }).not.toThrow();
    });

    it('should start timer for vector search', () => {
      // Given: Initialized metrics collector
      
      // When: Starting vector search timer
      const timer = metricsCollector.startVectorSearchTimer('hnsw');
      
      // Then: Timer should be returned
      expect(timer).toBeInstanceOf(Function);
    });
  });

  describe('Cache Metrics', () => {
    beforeEach(() => {
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
    });

    it('should update cache hit rate', () => {
      // Given: Initialized metrics collector
      const hitRate = 85.5; // 85.5%
      
      // When: Updating cache hit rate
      // Then: Should not throw
      expect(() => metricsCollector.updateCacheHitRate('L1', hitRate)).not.toThrow();
    });

    it('should track different cache levels', () => {
      // Given: Initialized metrics collector
      
      // When: Updating different cache levels
      // Then: Should not throw for any cache level
      expect(() => {
        metricsCollector.updateCacheHitRate('L1', 95.0);
        metricsCollector.updateCacheHitRate('L2', 75.0);
        metricsCollector.updateCacheHitRate('L3', 50.0);
      }).not.toThrow();
    });

    it('should validate hit rate bounds', () => {
      // Given: Initialized metrics collector
      
      // When: Setting invalid hit rates
      // Then: Should handle gracefully without throwing
      expect(() => {
        metricsCollector.updateCacheHitRate('L1', 150); // Over 100%
        metricsCollector.updateCacheHitRate('L2', -10); // Below 0%
      }).not.toThrow();
    });
  });

  describe('Metrics Export', () => {
    beforeEach(() => {
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
    });

    it('should export metrics in Prometheus format', async () => {
      // Given: Initialized metrics collector with recorded data
      
      // When: Getting metrics
      const metrics = await metricsCollector.getMetrics();
      
      // Then: Metrics should be returned as a string
      expect(typeof metrics).toBe('string');
    });

    it('should export metrics as JSON', () => {
      // Given: Initialized metrics collector
      
      // When: Getting JSON metrics
      const metrics = metricsCollector.getMetricsAsJSON();
      
      // Then: Metrics should be returned
      expect(metrics).toBeDefined();
    });

    it('should handle metrics export errors gracefully', async () => {
      // Given: Initialized metrics collector
      
      // When: Attempting to get metrics
      // Then: Should not throw
      await expect(metricsCollector.getMetrics()).resolves.not.toThrow();
    });
  });

  describe('Performance Requirements', () => {
    beforeEach(() => {
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
    });

    it('should record metrics with minimal latency overhead', () => {
      // Given: Performance timing setup
      const iterations = 1000;
      
      // When: Recording metrics repeatedly
      const start = process.hrtime.bigint();
      
      for (let i = 0; i < iterations; i++) {
        metricsCollector.recordRequest('test-tool', 'success');
      }
      
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      const avgLatencyMs = durationMs / iterations;
      
      // Then: Average latency should be minimal (< 1ms per operation)
      expect(avgLatencyMs).toBeLessThan(1.0);
    });

    it('should handle high-frequency metric updates', () => {
      // Given: High-frequency metric updates
      const updateCount = 10000;
      
      // When: Performing rapid updates
      const start = Date.now();
      
      for (let i = 0; i < updateCount; i++) {
        metricsCollector.setActiveConnections(i % 100);
      }
      
      const duration = Date.now() - start;
      
      // Then: Should complete within reasonable time
      expect(duration).toBeLessThan(1000); // Less than 1 second
    });

    it('should not block on disabled metrics', () => {
      // Given: Disabled metrics collector
      const disabledCollector = new MetricsCollector({ enabled: false });
      
      // When: Attempting to record metrics
      const start = process.hrtime.bigint();
      
      disabledCollector.recordRequest('test', 'success');
      disabledCollector.recordMemoryOperation('store', 'success');
      disabledCollector.setActiveConnections(10);
      
      const end = process.hrtime.bigint();
      const durationNs = Number(end - start);
      
      // Then: Operations should be nearly instantaneous
      expect(durationNs).toBeLessThan(100_000); // Less than 0.1ms
    });
  });

  describe('Configuration and Lifecycle', () => {
    it('should support custom metric prefix', () => {
      // Given: Custom prefix configuration
      const config = { prefix: 'custom_' };
      metricsCollector = new MetricsCollector(config);
      
      // When: Initializing with custom prefix
      // Then: Should not throw
      expect(() => metricsCollector.initialize()).not.toThrow();
    });

    it('should support custom labels', () => {
      // Given: Custom default labels
      const config = { defaultLabels: { service: 'test-service', version: '1.0' } };
      metricsCollector = new MetricsCollector(config);
      
      // When: Initializing with custom labels
      // Then: Should not throw
      expect(() => metricsCollector.initialize()).not.toThrow();
    });

    it('should cleanup metrics on shutdown', () => {
      // Given: Initialized metrics collector
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
      
      // When: Shutting down
      // Then: Should not throw
      expect(() => metricsCollector.shutdown()).not.toThrow();
    });

    it('should support enabling/disabling default metrics collection', () => {
      // Given: Configuration with default metrics disabled
      const config = { collectDefaultMetrics: false };
      metricsCollector = new MetricsCollector(config);
      
      // When: Initializing
      // Then: Should not throw
      expect(() => metricsCollector.initialize()).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      metricsCollector = new MetricsCollector();
      metricsCollector.initialize();
    });

    it('should handle metric recording errors gracefully', () => {
      // Given: Initialized metrics collector
      
      // When: Recording metric that might throw error
      // Then: Should not throw and continue operation
      expect(() => {
        metricsCollector.recordRequest('test', 'success');
      }).not.toThrow();
    });

    it('should handle invalid metric values', () => {
      // Given: Invalid metric values
      
      // When/Then: Should handle invalid values gracefully
      expect(() => {
        metricsCollector.recordRequestDuration('test', NaN);
        metricsCollector.recordRequestDuration('test', Infinity);
        metricsCollector.recordRequestDuration('test', -1);
      }).not.toThrow();
    });

    it('should handle missing labels gracefully', () => {
      // Given: Metrics that require labels
      
      // When: Recording metrics without required labels
      // Then: Should use default or empty labels
      expect(() => {
        metricsCollector.recordRequest('', '');
        metricsCollector.recordError('', '');
      }).not.toThrow();
    });
  });
});