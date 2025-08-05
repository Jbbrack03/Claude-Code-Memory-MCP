import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { ResourceMonitor, ResourceMonitorConfig, ResourcePressureLevel, ResourceMetrics, ThresholdConfig } from "../../src/monitoring/resource-monitor.js";
import { TestCleanupManager, withTimeout } from "../utils/test-helpers.js";
import type { Config } from "../../src/config/index.js";

// Mock system modules
jest.mock("os", () => ({
  totalmem: jest.fn(() => 16 * 1024 * 1024 * 1024), // 16GB
  freemem: jest.fn(() => 8 * 1024 * 1024 * 1024),   // 8GB
  cpus: jest.fn(() => Array(8).fill({ model: "Intel Core i7" })),
  loadavg: jest.fn(() => [1.5, 1.2, 1.0]),
  platform: jest.fn(() => "linux"),
  type: jest.fn(() => "Linux")
}));

jest.mock("fs", () => ({
  promises: {
    stat: jest.fn(),
    readdir: jest.fn(),
    access: jest.fn()
  },
  statSync: jest.fn()
}));

jest.mock("process", () => ({
  memoryUsage: jest.fn(() => ({
    rss: 100 * 1024 * 1024,      // 100MB
    heapTotal: 80 * 1024 * 1024,  // 80MB
    heapUsed: 60 * 1024 * 1024,   // 60MB
    external: 10 * 1024 * 1024,   // 10MB
    arrayBuffers: 5 * 1024 * 1024 // 5MB
  })),
  cpuUsage: jest.fn(() => ({ user: 100000, system: 50000 })),
  uptime: jest.fn(() => 3600), // 1 hour
  pid: 12345,
  platform: "linux"
}));

// Mock logger
jest.mock("../../src/utils/logger.js", () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  })
}));

describe('ResourceMonitor', () => {
  let monitor: ResourceMonitor;
  let cleanupManager: TestCleanupManager;
  let config: ResourceMonitorConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    cleanupManager = new TestCleanupManager();
    
    // Setup default config
    config = {
      enabled: true,
      monitoringInterval: 100, // Short interval for tests
      thresholds: {
        memory: {
          warning: 0.7,   // 70%
          critical: 0.9,  // 90%
          emergency: 0.95 // 95%
        },
        cpu: {
          warning: 0.6,   // 60%
          critical: 0.8,  // 80%
          emergency: 0.9  // 90%
        },
        disk: {
          warning: 0.8,   // 80%
          critical: 0.9,  // 90%
          emergency: 0.95 // 95%
        },
        fileDescriptors: {
          warning: 0.7,   // 70%
          critical: 0.85, // 85%
          emergency: 0.95 // 95%
        }
      },
      emergencyCleanup: true,
      performanceTracking: true,
      historySize: 100,
      alertCooldown: 1000 // 1 second for tests
    };
  });

  afterEach(async () => {
    if (monitor) {
      await monitor.stop().catch(() => {});
    }
    await cleanupManager.cleanup();
  });

  describe('configuration validation', () => {
    it('should throw error with invalid monitoring interval', () => {
      // Given: Invalid configuration with negative interval
      const invalidConfig = {
        ...config,
        monitoringInterval: -1000
      };
      
      // When/Then: Should throw validation error
      expect(() => new ResourceMonitor(invalidConfig)).toThrow("Invalid configuration");
    });

    it('should throw error with invalid memory threshold values', () => {
      // Given: Invalid memory thresholds (critical < warning)
      const invalidConfig = {
        ...config,
        thresholds: {
          ...config.thresholds,
          memory: {
            warning: 0.8,
            critical: 0.7, // Critical lower than warning
            emergency: 0.9
          }
        }
      };
      
      // When/Then: Should throw validation error
      expect(() => new ResourceMonitor(invalidConfig)).toThrow("Invalid threshold configuration");
    });

    it('should throw error with threshold values outside valid range', () => {
      // Given: Threshold values outside 0-1 range
      const invalidConfig = {
        ...config,
        thresholds: {
          ...config.thresholds,
          cpu: {
            warning: 1.5,  // > 1.0
            critical: 2.0,
            emergency: 2.5
          }
        }
      };
      
      // When/Then: Should throw validation error
      expect(() => new ResourceMonitor(invalidConfig)).toThrow("Threshold values must be between 0 and 1");
    });

    it('should validate all resource threshold configurations', () => {
      // Given: Configuration with missing threshold types
      const incompleteConfig = {
        ...config,
        thresholds: {
          memory: config.thresholds.memory
          // Missing cpu, disk, fileDescriptors
        } as any
      };
      
      // When/Then: Should throw validation error
      expect(() => new ResourceMonitor(incompleteConfig)).toThrow("Missing required threshold configuration");
    });

    it('should accept valid configuration', () => {
      // Given: Valid configuration
      const validConfig = config;
      
      // When: Creating monitor
      const validMonitor = new ResourceMonitor(validConfig);
      
      // Then: Should not throw
      expect(validMonitor).toBeDefined();
      expect(validMonitor.isRunning()).toBe(false);
    });
  });

  describe('initialization and lifecycle', () => {
    beforeEach(() => {
      monitor = new ResourceMonitor(config);
    });

    it('should initialize successfully', async () => {
      // Given: Uninitialized monitor
      expect(monitor.isRunning()).toBe(false);
      
      // When: Starting monitor
      await withTimeout(monitor.start(), 1000, "Monitor start");
      
      // Then: Should be running
      expect(monitor.isRunning()).toBe(true);
      
      const status = monitor.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.startTime).toBeDefined();
      expect(status.lastCollection).toBeDefined();
    });

    it('should handle start when already running', async () => {
      // Given: Monitor already started
      await monitor.start();
      expect(monitor.isRunning()).toBe(true);
      
      // When: Starting again
      await monitor.start();
      
      // Then: Should remain running without error
      expect(monitor.isRunning()).toBe(true);
    });

    it('should stop monitoring gracefully', async () => {
      // Given: Running monitor
      await monitor.start();
      expect(monitor.isRunning()).toBe(true);
      
      // When: Stopping monitor
      await withTimeout(monitor.stop(), 1000, "Monitor stop");
      
      // Then: Should be stopped
      expect(monitor.isRunning()).toBe(false);
      
      const status = monitor.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.stopTime).toBeDefined();
    });

    it('should handle stop when not running', async () => {
      // Given: Monitor not running
      expect(monitor.isRunning()).toBe(false);
      
      // When: Stopping
      await monitor.stop();
      
      // Then: Should not throw error
      expect(monitor.isRunning()).toBe(false);
    });

    it('should prevent resource collection when not running', () => {
      // Given: Monitor not started
      expect(monitor.isRunning()).toBe(false);
      
      // When/Then: Should throw error
      expect(() => monitor.getCurrentMetrics()).toThrow("ResourceMonitor not running");
      expect(() => monitor.getMetricsHistory()).toThrow("ResourceMonitor not running");
      expect(() => monitor.getPressureLevel()).toThrow("ResourceMonitor not running");
    });
  });

  describe('resource monitoring accuracy', () => {
    beforeEach(async () => {
      monitor = new ResourceMonitor(config);
      await monitor.start();
      
      // Wait for initial collection
      await new Promise(resolve => setTimeout(resolve, 150));
    });

    it('should collect accurate memory metrics', () => {
      // Given: Monitor is running
      expect(monitor.isRunning()).toBe(true);
      
      // When: Getting current metrics
      const metrics = monitor.getCurrentMetrics();
      
      // Then: Should have memory metrics
      expect(metrics.memory).toBeDefined();
      expect(metrics.memory.total).toBeGreaterThan(0);
      expect(metrics.memory.used).toBeGreaterThan(0);
      expect(metrics.memory.free).toBeGreaterThan(0);
      expect(metrics.memory.utilization).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.utilization).toBeLessThanOrEqual(1);
      
      // Memory accounting should be consistent
      expect(metrics.memory.used + metrics.memory.free).toBeCloseTo(metrics.memory.total, 0);
    });

    it('should collect accurate CPU metrics', () => {
      // Given: Monitor is running
      expect(monitor.isRunning()).toBe(true);
      
      // When: Getting current metrics
      const metrics = monitor.getCurrentMetrics();
      
      // Then: Should have CPU metrics
      expect(metrics.cpu).toBeDefined();
      expect(metrics.cpu.cores).toBeGreaterThan(0);
      expect(metrics.cpu.utilization).toBeGreaterThanOrEqual(0);
      expect(metrics.cpu.utilization).toBeLessThanOrEqual(1);
      expect(metrics.cpu.loadAverage).toBeDefined();
      expect(metrics.cpu.loadAverage.length).toBe(3);
    });

    it('should collect accurate process metrics', () => {
      // Given: Monitor is running
      expect(monitor.isRunning()).toBe(true);
      
      // When: Getting current metrics
      const metrics = monitor.getCurrentMetrics();
      
      // Then: Should have process metrics
      expect(metrics.process).toBeDefined();
      expect(metrics.process.pid).toBe(12345);
      expect(metrics.process.memoryUsage.rss).toBeGreaterThan(0);
      expect(metrics.process.memoryUsage.heapTotal).toBeGreaterThan(0);
      expect(metrics.process.memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(metrics.process.uptime).toBeGreaterThan(0);
    });

    it('should collect disk metrics when available', () => {
      // Given: Monitor is running
      expect(monitor.isRunning()).toBe(true);
      
      // When: Getting current metrics
      const metrics = monitor.getCurrentMetrics();
      
      // Then: Should attempt to collect disk metrics
      expect(metrics.disk).toBeDefined();
      // Note: Disk metrics may be null/undefined in test environment
    });

    it('should track metrics over time', async () => {
      // Given: Monitor running for a period
      const initialMetrics = monitor.getCurrentMetrics();
      
      // When: Waiting for multiple collections
      await new Promise(resolve => setTimeout(resolve, 250));
      
      // Then: Should have historical data
      const history = monitor.getMetricsHistory();
      expect(history.length).toBeGreaterThan(1);
      
      // Should maintain chronological order
      for (let i = 1; i < history.length; i++) {
        expect(history[i].timestamp).toBeGreaterThanOrEqual(history[i-1].timestamp);
      }
    });

    it('should limit history size according to configuration', async () => {
      // Given: Monitor with small history size
      await monitor.stop();
      const smallHistoryConfig = { ...config, historySize: 3 };
      monitor = new ResourceMonitor(smallHistoryConfig);
      await monitor.start();
      
      // When: Waiting for more collections than history size
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Then: Should not exceed history size
      const history = monitor.getMetricsHistory();
      expect(history.length).toBeLessThanOrEqual(3);
    });
  });

  describe('resource pressure detection', () => {
    beforeEach(async () => {
      monitor = new ResourceMonitor(config);
      await monitor.start();
      await new Promise(resolve => setTimeout(resolve, 150));
    });

    it('should detect normal pressure level', () => {
      // Given: Normal resource usage (mocked values are below thresholds)
      const pressureLevel = monitor.getPressureLevel();
      
      // Then: Should be normal
      expect(pressureLevel).toBe(ResourcePressureLevel.NORMAL);
    });

    it('should detect warning pressure level', (done) => {
      // Given: High memory usage (87.5% used)
      monitor.setTestMemoryOverride(
        16 * 1024 * 1024 * 1024,  // 16GB total
        2 * 1024 * 1024 * 1024    // 2GB free
      );
      
      // When: Getting pressure after high usage
      // Wait for next collection cycle
      setTimeout(() => {
        try {
          const pressureLevel = monitor.getPressureLevel();
          
          // Then: Should detect warning level
          expect(pressureLevel).toBe(ResourcePressureLevel.WARNING);
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    it('should detect critical pressure level', (done) => {
      // Given: Very high resource usage (93.75% used - above critical but below emergency)
      monitor.setTestMemoryOverride(
        16 * 1024 * 1024 * 1024,    // 16GB total
        1 * 1024 * 1024 * 1024      // 1GB free
      );
      
      // When: Getting pressure after critical usage
      setTimeout(() => {
        try {
          const pressureLevel = monitor.getPressureLevel();
          
          // Then: Should detect critical level
          expect(pressureLevel).toBe(ResourcePressureLevel.CRITICAL);
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    it('should detect emergency pressure level', (done) => {
      // Given: Extremely high resource usage (99.4% used)
      monitor.setTestMemoryOverride(
        16 * 1024 * 1024 * 1024,    // 16GB total
        0.1 * 1024 * 1024 * 1024    // 0.1GB free
      );
      
      // When: Getting pressure after emergency usage
      setTimeout(() => {
        try {
          const pressureLevel = monitor.getPressureLevel();
          
          // Then: Should detect emergency level
          expect(pressureLevel).toBe(ResourcePressureLevel.EMERGENCY);
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    it('should consider multiple resource types for pressure calculation', (done) => {
      // Given: Mixed resource pressure
      monitor.setTestMemoryOverride(
        16 * 1024 * 1024 * 1024,    // 16GB total
        4 * 1024 * 1024 * 1024      // 4GB free (75% used - warning)
      );
      monitor.setTestCpuOverride(8, [6.0, 5.5, 5.0]); // High CPU load (75% on 8 cores)
      
      // When: Getting overall pressure
      setTimeout(() => {
        try {
          const pressureLevel = monitor.getPressureLevel();
          
          // Then: Should use highest pressure level
          expect(pressureLevel).toBe(ResourcePressureLevel.WARNING);
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    it('should provide detailed pressure analysis', () => {
      // Given: Monitor is running
      expect(monitor.isRunning()).toBe(true);
      
      // When: Getting pressure analysis
      const analysis = monitor.getPressureAnalysis();
      
      // Then: Should provide detailed breakdown
      expect(analysis).toBeDefined();
      expect(analysis.overall).toBeDefined();
      expect(analysis.memory).toBeDefined();
      expect(analysis.cpu).toBeDefined();
      expect(analysis.recommendations).toBeDefined();
      expect(Array.isArray(analysis.recommendations)).toBe(true);
    });
  });

  describe('emergency cleanup integration', () => {
    let cleanupCalled = false;
    
    beforeEach(async () => {
      cleanupCalled = false;
      
      // Create monitor with emergency cleanup enabled
      monitor = new ResourceMonitor({
        ...config,
        emergencyCleanup: true
      });
      
      // Mock emergency cleanup handler
      monitor.onEmergencyCleanup((analysis) => {
        cleanupCalled = true;
        return Promise.resolve();
      });
      
      await monitor.start();
      await new Promise(resolve => setTimeout(resolve, 150));
    });

    it('should trigger emergency cleanup on critical pressure', async () => {
      // Given: Emergency resource conditions (99.7% used)
      monitor.setTestMemoryOverride(
        16 * 1024 * 1024 * 1024,     // 16GB total
        0.05 * 1024 * 1024 * 1024    // 0.05GB free
      );
      
      // When: Waiting for pressure detection
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Then: Should trigger emergency cleanup
      expect(cleanupCalled).toBe(true);
    });

    it('should not trigger cleanup when disabled', async () => {
      // Given: Monitor with cleanup disabled
      await monitor.stop();
      monitor = new ResourceMonitor({
        ...config,
        emergencyCleanup: false
      });
      await monitor.start();
      
      monitor.setTestMemoryOverride(
        16 * 1024 * 1024 * 1024,     // 16GB total
        0.05 * 1024 * 1024 * 1024    // 0.05GB free (emergency)
      );
      
      // When: Waiting for pressure detection
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Then: Should not trigger cleanup
      expect(cleanupCalled).toBe(false);
    });

    it('should respect alert cooldown period', async () => {
      // Given: Emergency conditions and recent cleanup
      monitor.setTestMemoryOverride(
        16 * 1024 * 1024 * 1024,     // 16GB total
        0.05 * 1024 * 1024 * 1024    // 0.05GB free (emergency)
      );
      
      // When: First cleanup trigger
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(cleanupCalled).toBe(true);
      
      cleanupCalled = false; // Reset flag
      
      // Wait less than cooldown period
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Then: Should not trigger again due to cooldown
      expect(cleanupCalled).toBe(false);
    });

    it('should handle cleanup handler errors gracefully', async () => {
      // Given: Cleanup handler that throws
      monitor.onEmergencyCleanup(async () => {
        throw new Error("Cleanup failed");
      });
      
      monitor.setTestMemoryOverride(
        16 * 1024 * 1024 * 1024,     // 16GB total
        0.05 * 1024 * 1024 * 1024    // 0.05GB free (emergency)
      );
      
      // When: Triggering cleanup
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Then: Monitor should continue running despite cleanup error
      expect(monitor.isRunning()).toBe(true);
    });
  });

  describe('performance requirements', () => {
    beforeEach(async () => {
      monitor = new ResourceMonitor({
        ...config,
        performanceTracking: true
      });
      await monitor.start();
    });

    it('should meet collection performance requirements', async () => {
      // Given: Monitor is running
      expect(monitor.isRunning()).toBe(true);
      
      // When: Measuring collection performance
      const start = Date.now();
      const metrics = monitor.getCurrentMetrics();
      const duration = Date.now() - start;
      
      // Then: Should collect metrics quickly (< 50ms)
      expect(duration).toBeLessThan(50);
      expect(metrics).toBeDefined();
    });

    it('should maintain consistent monitoring interval', async () => {
      // Given: Monitor with specific interval
      const timestamps: number[] = [];
      let collectionCount = 0;
      
      // Monitor collection events
      monitor.onMetricsCollected(() => {
        timestamps.push(Date.now());
        collectionCount++;
      });
      
      // When: Waiting for multiple collections
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Then: Should maintain consistent intervals
      expect(collectionCount).toBeGreaterThan(3);
      
      // Check interval consistency (allow ±20ms variance)
      for (let i = 1; i < timestamps.length; i++) {
        const interval = timestamps[i] - timestamps[i-1];
        expect(interval).toBeGreaterThan(80);  // config.monitoringInterval - 20ms
        expect(interval).toBeLessThan(120);    // config.monitoringInterval + 20ms
      }
    });

    it('should track performance metrics', () => {
      // Given: Monitor with performance tracking
      expect(monitor.isRunning()).toBe(true);
      
      // When: Getting performance stats
      const perfStats = monitor.getPerformanceStats();
      
      // Then: Should provide performance metrics
      expect(perfStats).toBeDefined();
      expect(perfStats.totalCollections).toBeGreaterThan(0);
      expect(perfStats.averageCollectionTime).toBeGreaterThan(0);
      expect(perfStats.maxCollectionTime).toBeGreaterThan(0);
      expect(perfStats.collectionErrors).toBeGreaterThanOrEqual(0);
    });

    it('should handle concurrent metric requests efficiently', async () => {
      // Given: Monitor is running
      expect(monitor.isRunning()).toBe(true);
      
      // When: Making concurrent requests
      const promises = Array.from({ length: 10 }, () => 
        Promise.resolve(monitor.getCurrentMetrics())
      );
      
      const start = Date.now();
      const results = await Promise.all(promises);
      const duration = Date.now() - start;
      
      // Then: Should handle concurrent requests quickly
      expect(duration).toBeLessThan(100);
      expect(results.length).toBe(10);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.memory).toBeDefined();
      });
    });
  });

  describe('error handling and resilience', () => {
    beforeEach(async () => {
      monitor = new ResourceMonitor(config);
      await monitor.start();
    });

    it('should handle OS metrics collection errors gracefully', async () => {
      // Given: OS module that throws errors
      monitor.simulateOsError();
      
      // When: Attempting to collect metrics
      // Force a collection by getting pressure level
      try {
        monitor.getPressureLevel();
      } catch (e) {
        // Ignore any errors from getPressureLevel
      }
      
      // Wait for async collection cycle as well
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Then: Monitor should continue running
      expect(monitor.isRunning()).toBe(true);
      
      // Should track collection errors
      const perfStats = monitor.getPerformanceStats();
      expect(perfStats.collectionErrors).toBeGreaterThan(0);
    });

    it('should handle process metrics errors gracefully', async () => {
      // Given: Process module that throws errors
      const originalMemoryUsage = process.memoryUsage;
      (process as any).memoryUsage = jest.fn(() => {
        throw new Error("Process error");
      });
      
      // When: Collecting metrics with process error
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Then: Should continue monitoring
      expect(monitor.isRunning()).toBe(true);
      
      // Restore original function
      (process as any).memoryUsage = originalMemoryUsage;
    });

    it('should recover from temporary system issues', async () => {
      // Given: Temporary system error
      const os = require('os');
      let errorCount = 0;
      const originalFreemem = os.freemem;
      
      os.freemem.mockImplementation(() => {
        errorCount++;
        if (errorCount <= 2) {
          throw new Error("Temporary error");
        }
        return originalFreemem();
      });
      
      // When: Waiting for recovery
      await new Promise(resolve => setTimeout(resolve, 400));
      
      // Then: Should recover and continue monitoring
      expect(monitor.isRunning()).toBe(true);
      const metrics = monitor.getCurrentMetrics();
      expect(metrics.memory).toBeDefined();
    });

    it('should handle invalid metric values', async () => {
      // Given: OS returning invalid values
      const os = require('os');
      os.freemem.mockReturnValue(-1000); // Invalid negative value
      os.totalmem.mockReturnValue(0);     // Invalid zero value
      
      // When: Collecting metrics with invalid values
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Then: Should sanitize and continue
      expect(monitor.isRunning()).toBe(true);
      
      const metrics = monitor.getCurrentMetrics();
      expect(metrics.memory.free).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.total).toBeGreaterThan(0);
    });

    it('should handle monitoring interval changes during runtime', async () => {
      // Given: Running monitor
      expect(monitor.isRunning()).toBe(true);
      
      // When: Updating configuration
      monitor.updateConfig({
        ...config,
        monitoringInterval: 200
      });
      
      // Then: Should apply new interval
      const timestamps: number[] = [];
      monitor.onMetricsCollected(() => {
        timestamps.push(Date.now());
      });
      
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // Check new interval (allow variance)
      for (let i = 1; i < timestamps.length; i++) {
        const interval = timestamps[i] - timestamps[i-1];
        expect(interval).toBeGreaterThan(180);
        expect(interval).toBeLessThan(220);
      }
    });

    it('should handle system shutdown gracefully', async () => {
      // Given: Running monitor
      expect(monitor.isRunning()).toBe(true);
      
      // When: Simulating system shutdown
      const shutdownPromise = monitor.shutdown();
      
      // Then: Should shutdown gracefully
      await expect(shutdownPromise).resolves.not.toThrow();
      expect(monitor.isRunning()).toBe(false);
    });
  });

  describe('integration with existing systems', () => {
    beforeEach(async () => {
      monitor = new ResourceMonitor(config);
      await monitor.start();
    });

    it('should integrate with memory manager', async () => {
      // Given: Monitor running
      expect(monitor.isRunning()).toBe(true);
      
      // When: Getting memory manager integration
      const memoryIntegration = monitor.getMemoryManagerIntegration();
      
      // Then: Should provide integration interface
      expect(memoryIntegration).toBeDefined();
      expect(typeof memoryIntegration.getCurrentMemoryPressure).toBe('function');
      expect(typeof memoryIntegration.shouldTriggerCleanup).toBe('function');
    });

    it('should integrate with metrics collector', async () => {
      // Given: Monitor with metrics integration
      expect(monitor.isRunning()).toBe(true);
      
      // When: Getting metrics for prometheus
      const prometheusMetrics = monitor.getPrometheusMetrics();
      
      // Then: Should provide formatted metrics
      expect(prometheusMetrics).toBeDefined();
      expect(typeof prometheusMetrics).toBe('string');
      expect(prometheusMetrics).toContain('memory_utilization');
      expect(prometheusMetrics).toContain('cpu_utilization');
    });

    it('should provide health check interface', () => {
      // Given: Running monitor
      expect(monitor.isRunning()).toBe(true);
      
      // When: Getting health status
      const healthStatus = monitor.getHealthStatus();
      
      // Then: Should provide health information
      expect(healthStatus).toBeDefined();
      expect(healthStatus.status).toBe('healthy');
      expect(healthStatus.details).toBeDefined();
      expect(healthStatus.details.monitoring).toBe(true);
      expect(healthStatus.details.pressure).toBeDefined();
    });

    it('should support alert configuration', () => {
      // Given: Monitor instance
      expect(monitor).toBeDefined();
      
      // When: Configuring alerts
      const alertConfig = {
        memory: { enabled: true, threshold: 0.8 },
        cpu: { enabled: true, threshold: 0.7 },
        webhook: { url: 'http://localhost:3000/alerts' }
      };
      
      monitor.configureAlerts(alertConfig);
      
      // Then: Should accept alert configuration
      const currentConfig = monitor.getAlertConfiguration();
      expect(currentConfig.memory.enabled).toBe(true);
      expect(currentConfig.cpu.enabled).toBe(true);
    });

    it('should provide event subscription interface', async () => {
      // Given: Monitor instance
      let pressureChangeEvents = 0;
      let metricsCollectedEvents = 0;
      
      // When: Subscribing to events
      monitor.onPressureChange(() => {
        pressureChangeEvents++;
      });
      
      monitor.onMetricsCollected(() => {
        metricsCollectedEvents++;
      });
      
      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Then: Should receive events
      expect(metricsCollectedEvents).toBeGreaterThan(0);
    });
  });

  describe('configuration updates', () => {
    beforeEach(async () => {
      monitor = new ResourceMonitor(config);
      await monitor.start();
    });

    it('should handle threshold updates during runtime', async () => {
      // Given: Running monitor with initial thresholds
      const initialConfig = monitor.getConfiguration();
      expect(initialConfig.thresholds.memory.warning).toBe(0.7);
      
      // When: Updating thresholds
      const newConfig = {
        ...config,
        thresholds: {
          ...config.thresholds,
          memory: {
            warning: 0.6,
            critical: 0.8,
            emergency: 0.9
          }
        }
      };
      
      monitor.updateConfig(newConfig);
      
      // Then: Should use new thresholds
      const updatedConfig = monitor.getConfiguration();
      expect(updatedConfig.thresholds.memory.warning).toBe(0.6);
    });

    it('should validate configuration updates', () => {
      // Given: Running monitor
      expect(monitor.isRunning()).toBe(true);
      
      // When: Attempting invalid configuration update
      const invalidConfig = {
        ...config,
        monitoringInterval: -500 // Invalid
      };
      
      // Then: Should reject invalid configuration
      expect(() => monitor.updateConfig(invalidConfig)).toThrow("Invalid configuration");
    });

    it('should handle monitoring interval changes', async () => {
      // Given: Monitor with initial interval
      const initialInterval = monitor.getConfiguration().monitoringInterval;
      expect(initialInterval).toBe(100);
      
      // When: Updating interval
      monitor.updateConfig({
        ...config,
        monitoringInterval: 300
      });
      
      // Then: Should apply new interval
      const updatedInterval = monitor.getConfiguration().monitoringInterval;
      expect(updatedInterval).toBe(300);
    });
  });
});