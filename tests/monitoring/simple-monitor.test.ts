import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { performance } from 'perf_hooks';
import * as os from 'os';

// The SimpleMonitor doesn't exist yet - this will fail until implemented
import { SimpleMonitor } from '../../src/monitoring/simple-monitor.js';

describe('SimpleMonitor', () => {
  let monitor: SimpleMonitor;
  let initialMemoryUsage: number;
  let initialCpuTime: number;

  beforeEach(() => {
    // Capture baseline metrics before test
    initialMemoryUsage = process.memoryUsage().heapUsed;
    initialCpuTime = process.cpuUsage().user + process.cpuUsage().system;
  });

  afterEach(async () => {
    if (monitor) {
      await monitor.shutdown();
    }
  });

  describe('Basic Functionality', () => {
    test('should create SimpleMonitor instance with default config', () => {
      // Given: Default configuration
      // When: Creating SimpleMonitor instance
      monitor = new SimpleMonitor();
      
      // Then: Should create valid instance
      expect(monitor).toBeDefined();
      expect(monitor).toBeInstanceOf(SimpleMonitor);
    });

    test('should create SimpleMonitor instance with custom config', () => {
      // Given: Custom configuration
      const config = {
        metricsEnabled: false,
        healthCheckInterval: 60000,
        logLevel: 'error'
      };
      
      // When: Creating SimpleMonitor with config
      monitor = new SimpleMonitor(config);
      
      // Then: Should create valid instance with custom config
      expect(monitor).toBeDefined();
      expect(monitor.getConfig().metricsEnabled).toBe(false);
      expect(monitor.getConfig().healthCheckInterval).toBe(60000);
      expect(monitor.getConfig().logLevel).toBe('error');
    });

    test('should initialize quickly without heavy dependencies', async () => {
      // Given: SimpleMonitor instance
      monitor = new SimpleMonitor();
      
      // When: Measuring initialization time
      const startTime = performance.now();
      await monitor.initialize();
      const initializationTime = performance.now() - startTime;
      
      // Then: Should initialize in < 100ms (vs current 500ms+)
      expect(initializationTime).toBeLessThan(100);
    });

    test('should have minimal memory footprint after initialization', async () => {
      // Given: Baseline memory usage
      const baselineMemory = process.memoryUsage().heapUsed;
      
      // When: Creating and initializing monitor
      monitor = new SimpleMonitor();
      await monitor.initialize();
      const afterInitMemory = process.memoryUsage().heapUsed;
      
      // Then: Should use < 10MB additional memory (vs current 50MB+)
      const memoryIncrease = (afterInitMemory - baselineMemory) / (1024 * 1024);
      expect(memoryIncrease).toBeLessThan(10);
    });
  });

  describe('Basic Metrics Collection', () => {
    beforeEach(async () => {
      monitor = new SimpleMonitor({ metricsEnabled: true });
      await monitor.initialize();
    });

    test('should collect CPU usage metrics', async () => {
      // Given: Initialized monitor
      // When: Collecting CPU metrics
      const metrics = await monitor.getMetrics();
      
      // Then: Should return CPU usage data
      expect(metrics.cpu).toBeDefined();
      expect(typeof metrics.cpu.usage).toBe('number');
      expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
      expect(metrics.cpu.usage).toBeLessThanOrEqual(100);
    });

    test('should collect memory usage metrics', async () => {
      // Given: Initialized monitor
      // When: Collecting memory metrics
      const metrics = await monitor.getMetrics();
      
      // Then: Should return memory usage data
      expect(metrics.memory).toBeDefined();
      expect(typeof metrics.memory.heapUsed).toBe('number');
      expect(typeof metrics.memory.heapTotal).toBe('number');
      expect(typeof metrics.memory.rss).toBe('number');
      expect(metrics.memory.heapUsed).toBeGreaterThan(0);
    });

    test('should track operation counts', async () => {
      // Given: Initialized monitor
      const initialMetrics = await monitor.getMetrics();
      const initialCount = initialMetrics.operations.total || 0;
      
      // When: Incrementing operation count
      monitor.incrementOperationCount('test_operation');
      monitor.incrementOperationCount('test_operation');
      
      // Then: Should track operation counts
      const updatedMetrics = await monitor.getMetrics();
      expect(updatedMetrics.operations.total).toBe(initialCount + 2);
      expect(updatedMetrics.operations.byType.test_operation).toBe(2);
    });

    test('should track operation timing', async () => {
      // Given: Initialized monitor
      // When: Timing an operation
      const timer = monitor.startTimer('test_timing');
      await new Promise(resolve => setTimeout(resolve, 10)); // Simulate work
      const duration = timer.end();
      
      // Then: Should return valid duration
      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThan(1000); // Should be in ms
      
      // And metrics should include timing data
      const metrics = await monitor.getMetrics();
      expect(metrics.operations.averageDuration).toBeDefined();
    });

    test('should have minimal CPU overhead during metrics collection', async () => {
      // Given: Baseline CPU usage
      const startCpu = process.cpuUsage();
      
      // When: Collecting metrics multiple times
      for (let i = 0; i < 100; i++) {
        await monitor.getMetrics();
      }
      
      const endCpu = process.cpuUsage(startCpu);
      const cpuPercent = ((endCpu.user + endCpu.system) / 1000000) / 0.1; // Assume 0.1s elapsed
      
      // Then: Should use < 1% CPU (vs current 5%)
      expect(cpuPercent).toBeLessThan(1);
    });
  });

  describe('Simple Health Checks', () => {
    beforeEach(async () => {
      monitor = new SimpleMonitor({ 
        healthCheckEnabled: true,
        healthCheckInterval: 1000 
      });
      await monitor.initialize();
    });

    test('should return basic alive/dead health status', async () => {
      // Given: Initialized monitor
      // When: Checking health status
      const health = await monitor.getHealthStatus();
      
      // Then: Should return simple health status
      expect(health.status).toBe('alive');
      expect(health.timestamp).toBeDefined();
      expect(health.uptime).toBeGreaterThan(0);
    });

    test('should perform periodic health checks', async () => {
      // Given: Monitor with short health check interval
      let healthCheckCount = 0;
      monitor.onHealthCheck(() => {
        healthCheckCount++;
      });
      
      // When: Waiting for multiple health check cycles
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Then: Should have performed multiple health checks
      expect(healthCheckCount).toBeGreaterThan(1);
    });

    test('should detect unhealthy state on error', async () => {
      // Given: Monitor that will encounter an error
      const errorMonitor = new SimpleMonitor();
      await errorMonitor.initialize();
      
      // When: Simulating an error condition
      errorMonitor.setUnhealthy('Test error condition');
      const health = await errorMonitor.getHealthStatus();
      
      // Then: Should report unhealthy status
      expect(health.status).toBe('dead');
      expect(health.error).toBe('Test error condition');
      
      await errorMonitor.shutdown();
    });

    test('should have minimal overhead during health checks', async () => {
      // Given: Baseline performance
      const startTime = performance.now();
      
      // When: Performing multiple health checks
      for (let i = 0; i < 50; i++) {
        await monitor.getHealthStatus();
      }
      
      const totalTime = performance.now() - startTime;
      const averageTime = totalTime / 50;
      
      // Then: Each health check should be < 5ms
      expect(averageTime).toBeLessThan(5);
    });
  });

  describe('Basic Logging', () => {
    beforeEach(async () => {
      monitor = new SimpleMonitor({ 
        logLevel: 'info',
        logToConsole: false // Don't clutter test output
      });
      await monitor.initialize();
    });

    test('should provide simple logging interface', () => {
      // Given: Initialized monitor
      // When: Using logging methods
      expect(() => {
        monitor.log('info', 'Test info message');
        monitor.log('warn', 'Test warning message');
        monitor.log('error', 'Test error message');
      }).not.toThrow();
    });

    test('should respect log level configuration', () => {
      // Given: Monitor with error-level logging
      const errorMonitor = new SimpleMonitor({ logLevel: 'error' });
      const logs: string[] = [];
      
      // Mock log capture
      errorMonitor.onLog((level, message) => {
        logs.push(`${level}: ${message}`);
      });
      
      // When: Logging at different levels
      errorMonitor.log('info', 'Info message');
      errorMonitor.log('warn', 'Warning message');
      errorMonitor.log('error', 'Error message');
      
      // Then: Should only capture error-level logs
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('error: Error message');
    });

    test('should not include OpenTelemetry overhead', async () => {
      // Given: Multiple log operations
      const startTime = performance.now();
      
      // When: Performing many log operations
      for (let i = 0; i < 1000; i++) {
        monitor.log('info', `Log message ${i}`);
      }
      
      const totalTime = performance.now() - startTime;
      
      // Then: Should complete quickly without tracing overhead
      expect(totalTime).toBeLessThan(100); // Should be much faster than OpenTelemetry
    });
  });

  describe('Performance Impact', () => {
    test('should have minimal CPU usage over time', async () => {
      // Given: Monitor running with all features enabled
      monitor = new SimpleMonitor({
        metricsEnabled: true,
        healthCheckEnabled: true,
        healthCheckInterval: 500,
        logLevel: 'info'
      });
      await monitor.initialize();
      
      // When: Running monitor for extended period
      const startCpu = process.cpuUsage();
      
      // Simulate activity
      for (let i = 0; i < 50; i++) {
        monitor.incrementOperationCount('test');
        await monitor.getMetrics();
        monitor.log('info', `Test log ${i}`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      const endCpu = process.cpuUsage(startCpu);
      const cpuTime = (endCpu.user + endCpu.system) / 1000000; // Convert to seconds
      
      // Then: Should use < 1% of CPU time over 0.5+ seconds
      expect(cpuTime).toBeLessThan(0.005); // < 5ms of CPU time
    });

    test('should maintain stable memory usage', async () => {
      // Given: Monitor with metrics collection
      monitor = new SimpleMonitor({ metricsEnabled: true });
      await monitor.initialize();
      
      const initialMemory = process.memoryUsage().heapUsed;
      
      // When: Performing many operations
      for (let i = 0; i < 1000; i++) {
        monitor.incrementOperationCount('memory_test');
        await monitor.getMetrics();
        
        // Check memory periodically
        if (i % 100 === 0) {
          const currentMemory = process.memoryUsage().heapUsed;
          const memoryIncrease = (currentMemory - initialMemory) / (1024 * 1024);
          
          // Memory should not grow significantly
          expect(memoryIncrease).toBeLessThan(5); // < 5MB increase
        }
      }
      
      // Then: Final memory check
      const finalMemory = process.memoryUsage().heapUsed;
      const totalIncrease = (finalMemory - initialMemory) / (1024 * 1024);
      expect(totalIncrease).toBeLessThan(10); // < 10MB total increase
    });

    test('should start faster than current monitoring system', async () => {
      // Given: Multiple monitor instances to average startup time
      const startupTimes: number[] = [];
      
      // When: Creating and initializing multiple monitors
      for (let i = 0; i < 5; i++) {
        const testMonitor = new SimpleMonitor();
        const startTime = performance.now();
        await testMonitor.initialize();
        const initTime = performance.now() - startTime;
        startupTimes.push(initTime);
        await testMonitor.shutdown();
      }
      
      const averageStartup = startupTimes.reduce((sum, time) => sum + time, 0) / startupTimes.length;
      
      // Then: Should average < 100ms startup (vs current 500ms+)
      expect(averageStartup).toBeLessThan(100);
    });
  });

  describe('Feature Parity', () => {
    beforeEach(async () => {
      monitor = new SimpleMonitor({
        metricsEnabled: true,
        healthCheckEnabled: true
      });
      await monitor.initialize();
    });

    test('should provide essential metrics equivalent to complex system', async () => {
      // Given: Monitor with metrics enabled
      // When: Collecting comprehensive metrics
      const metrics = await monitor.getMetrics();
      
      // Then: Should provide essential monitoring data
      expect(metrics).toMatchObject({
        cpu: expect.objectContaining({
          usage: expect.any(Number)
        }),
        memory: expect.objectContaining({
          heapUsed: expect.any(Number),
          heapTotal: expect.any(Number),
          rss: expect.any(Number)
        }),
        operations: expect.objectContaining({
          total: expect.any(Number),
          byType: expect.any(Object)
        }),
        uptime: expect.any(Number),
        timestamp: expect.any(Number)
      });
    });

    test('should provide health monitoring equivalent to complex system', async () => {
      // Given: Monitor with health checks enabled
      // When: Getting health status
      const health = await monitor.getHealthStatus();
      
      // Then: Should provide essential health information
      expect(health).toMatchObject({
        status: expect.stringMatching(/^(alive|dead)$/),
        timestamp: expect.any(Number),
        uptime: expect.any(Number)
      });
    });

    test('should support basic logging equivalent to structured logger', () => {
      // Given: Monitor with logging capability
      const logEntries: Array<{level: string, message: string, timestamp: number}> = [];
      
      monitor.onLog((level, message, timestamp) => {
        logEntries.push({ level, message, timestamp });
      });
      
      // When: Logging at different levels
      monitor.log('info', 'Info message');
      monitor.log('warn', 'Warning message');
      monitor.log('error', 'Error message');
      
      // Then: Should capture all log levels with timestamps
      expect(logEntries).toHaveLength(3);
      expect(logEntries[0]).toMatchObject({
        level: 'info',
        message: 'Info message',
        timestamp: expect.any(Number)
      });
    });

    test('should support integration with storage engine', async () => {
      // Given: Mock storage engine
      const mockStorage = {
        getStatistics: jest.fn().mockResolvedValue({
          totalMemories: 100,
          totalSize: 1024000
        })
      };
      
      // When: Integrating with storage
      monitor.integrateWithStorage(mockStorage);
      const metrics = await monitor.getMetrics();
      
      // Then: Should include storage metrics
      expect(metrics.storage).toBeDefined();
      expect(metrics.storage.totalMemories).toBe(100);
      expect(metrics.storage.totalSize).toBe(1024000);
    });

    test('should support basic error tracking', () => {
      // Given: Monitor with error tracking
      const errors: Error[] = [];
      monitor.onError((error) => {
        errors.push(error);
      });
      
      // When: Tracking errors
      const testError = new Error('Test error');
      monitor.trackError(testError);
      
      // Then: Should capture errors
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Test error');
    });
  });

  describe('Configuration', () => {
    test('should support environment-based configuration switching', () => {
      // Given: Environment variable for simple monitoring
      const originalEnv = process.env.MONITORING_MODE;
      process.env.MONITORING_MODE = 'simple';
      
      try {
        // When: Creating monitor with environment config
        monitor = new SimpleMonitor();
        
        // Then: Should recognize environment configuration
        expect(monitor.getConfig().mode).toBe('simple');
      } finally {
        // Restore environment
        if (originalEnv !== undefined) {
          process.env.MONITORING_MODE = originalEnv;
        } else {
          delete process.env.MONITORING_MODE;
        }
      }
    });

    test('should allow disabling features for even lighter footprint', async () => {
      // Given: Minimal configuration
      const minimalMonitor = new SimpleMonitor({
        metricsEnabled: false,
        healthCheckEnabled: false,
        logLevel: 'error'
      });
      
      // When: Initializing minimal monitor
      const startTime = performance.now();
      const startMemory = process.memoryUsage().heapUsed;
      
      await minimalMonitor.initialize();
      
      const initTime = performance.now() - startTime;
      const memoryUsed = (process.memoryUsage().heapUsed - startMemory) / (1024 * 1024);
      
      // Then: Should be even faster and lighter
      expect(initTime).toBeLessThan(50); // Even faster initialization
      expect(memoryUsed).toBeLessThan(5); // Even less memory usage
      
      await minimalMonitor.shutdown();
    });

    test('should maintain backward compatibility with complex monitoring interface', async () => {
      // Given: Monitor configured to mimic complex system interface
      monitor = new SimpleMonitor({ compatibilityMode: true });
      await monitor.initialize();
      
      // When: Using complex monitoring methods
      expect(() => {
        // These methods should exist for compatibility but be simplified
        monitor.getMetrics();
        monitor.getHealthStatus();
        monitor.log('info', 'test');
      }).not.toThrow();
      
      // Then: Should provide simplified implementations of complex features
      const metrics = await monitor.getMetrics();
      expect(metrics).toBeDefined();
    });
  });

  describe('Graceful Shutdown', () => {
    test('should shutdown cleanly and quickly', async () => {
      // Given: Fully initialized monitor
      monitor = new SimpleMonitor({
        metricsEnabled: true,
        healthCheckEnabled: true,
        healthCheckInterval: 1000
      });
      await monitor.initialize();
      
      // When: Shutting down
      const startTime = performance.now();
      await monitor.shutdown();
      const shutdownTime = performance.now() - startTime;
      
      // Then: Should shutdown quickly
      expect(shutdownTime).toBeLessThan(50); // < 50ms shutdown
    });

    test('should clean up resources properly', async () => {
      // Given: Monitor with active intervals
      monitor = new SimpleMonitor({
        healthCheckEnabled: true,
        healthCheckInterval: 100
      });
      await monitor.initialize();
      
      let healthCheckCalls = 0;
      monitor.onHealthCheck(() => {
        healthCheckCalls++;
      });
      
      // Wait for some health checks
      await new Promise(resolve => setTimeout(resolve, 250));
      const initialCalls = healthCheckCalls;
      
      // When: Shutting down
      await monitor.shutdown();
      
      // Wait to ensure no more health checks occur
      await new Promise(resolve => setTimeout(resolve, 250));
      const finalCalls = healthCheckCalls;
      
      // Then: Should stop all periodic operations
      expect(finalCalls).toBe(initialCalls); // No additional calls after shutdown
    });
  });

  describe('Error Handling', () => {
    test('should handle initialization failures gracefully', async () => {
      // Given: Monitor that will fail during initialization
      monitor = new SimpleMonitor();
      
      // Mock a failure condition
      const originalGetMetrics = monitor.getMetrics;
      monitor.getMetrics = jest.fn().mockRejectedValue(new Error('Initialization failed'));
      
      // When/Then: Should handle initialization failure
      await expect(monitor.initialize()).rejects.toThrow('Initialization failed');
    });

    test('should continue operating with degraded functionality on partial failures', async () => {
      // Given: Monitor with some functionality failing
      monitor = new SimpleMonitor({
        metricsEnabled: true,
        healthCheckEnabled: true
      });
      await monitor.initialize();
      
      // Simulate metrics failure
      const originalGetMetrics = monitor.getMetrics;
      monitor.getMetrics = jest.fn().mockRejectedValue(new Error('Metrics failed'));
      
      // When: Health check should still work
      const health = await monitor.getHealthStatus();
      
      // Then: Should indicate degraded but still provide basic health
      expect(health.status).toBe('alive'); // Still alive despite metrics failure
    });

    test('should not crash on invalid configuration', () => {
      // Given: Invalid configuration
      const invalidConfig = {
        healthCheckInterval: -1,
        logLevel: 'invalid_level' as any,
        metricsEnabled: 'not_boolean' as any
      };
      
      // When/Then: Should handle invalid config gracefully
      expect(() => {
        monitor = new SimpleMonitor(invalidConfig);
      }).not.toThrow();
      
      // And should use safe defaults
      expect(monitor.getConfig().healthCheckInterval).toBeGreaterThan(0);
      expect(['error', 'warn', 'info', 'debug']).toContain(monitor.getConfig().logLevel);
      expect(typeof monitor.getConfig().metricsEnabled).toBe('boolean');
    });
  });
});