import { MonitoringSystem } from '../../src/monitoring/index.js';
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock prom-client to avoid issues in tests
jest.mock('prom-client', () => ({
  Registry: jest.fn().mockImplementation(() => ({
    setDefaultLabels: jest.fn(),
    metrics: jest.fn().mockResolvedValue('# Mock metrics'),
    resetMetrics: jest.fn()
  })),
  Counter: jest.fn().mockImplementation(() => ({
    inc: jest.fn()
  })),
  Histogram: jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    startTimer: jest.fn().mockReturnValue(jest.fn())
  })),
  Gauge: jest.fn().mockImplementation(() => ({
    set: jest.fn()
  })),
  Summary: jest.fn().mockImplementation(() => ({
    observe: jest.fn()
  })),
  collectDefaultMetrics: jest.fn()
}));

describe('MonitoringSystem Integration', () => {
  let monitoring: MonitoringSystem;
  
  beforeEach(() => {
    monitoring = new MonitoringSystem({
      metrics: { enabled: false }, // Disable metrics server for tests
      tracing: { enabled: false }, // Disable tracing for tests
      healthChecks: { enabled: true, interval: 30000 },
      alerting: { enabled: true, checkInterval: 60000 }
    });
  });
  
  afterEach(async () => {
    if (monitoring) {
      await monitoring.shutdown();
    }
  });
  
  describe('initialization', () => {
    test('should initialize monitoring system with default config', () => {
      const defaultMonitoring = new MonitoringSystem();
      expect(defaultMonitoring).toBeDefined();
    });
    
    test('should initialize monitoring system with custom config', () => {
      const customMonitoring = new MonitoringSystem({
        metrics: {
          enabled: true,
          prefix: 'custom_test',
          port: 9091
        },
        tracing: {
          enabled: false,
          serviceName: 'test-service'
        },
        healthChecks: {
          enabled: false
        },
        alerting: {
          enabled: false
        }
      });
      
      expect(customMonitoring).toBeDefined();
    });
    
    test('should initialize all subsystems', async () => {
      await monitoring.initialize();
      
      expect(monitoring.getMetrics()).toBeDefined();
      expect(monitoring.getInstrumentation()).toBeDefined();
      expect(monitoring.getLogger()).toBeDefined();
      expect(monitoring.getHealthCheck()).toBeDefined();
      expect(monitoring.getAlertManager()).toBeDefined();
    });
  });
  
  describe('subsystem access', () => {
    beforeEach(async () => {
      await monitoring.initialize();
    });
    
    test('should provide access to metrics collector', () => {
      const metrics = monitoring.getMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics.recordMemoryCapture).toBe('function');
      expect(typeof metrics.recordOperationDuration).toBe('function');
    });
    
    test('should provide access to instrumentation', () => {
      const instrumentation = monitoring.getInstrumentation();
      expect(instrumentation).toBeDefined();
      expect(typeof instrumentation.traceOperation).toBe('function');
      expect(typeof instrumentation.traceMemoryCapture).toBe('function');
    });
    
    test('should provide access to structured logger', () => {
      const logger = monitoring.getLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.logMemoryOperation).toBe('function');
    });
    
    test('should provide access to health check service', () => {
      const healthCheck = monitoring.getHealthCheck();
      expect(healthCheck).toBeDefined();
      expect(typeof healthCheck.performHealthCheck).toBe('function');
      expect(typeof healthCheck.registerCheck).toBe('function');
    });
    
    test('should provide access to alert manager', () => {
      const alertManager = monitoring.getAlertManager();
      expect(alertManager).toBeDefined();
      expect(typeof alertManager.registerRule).toBe('function');
      expect(typeof alertManager.checkRules).toBe('function');
    });
  });
  
  describe('integration with storage', () => {
    test('should integrate with storage engine', async () => {
      await monitoring.initialize();
      
      const mockStorage = {
        getStorageStats: jest.fn().mockResolvedValue({
          totalMemories: 100,
          totalSize: 1024 * 1024
        })
      };
      
      expect(() => {
        monitoring.integrateWithStorage(mockStorage as any);
      }).not.toThrow();
    });
  });
  
  describe('integration with hooks', () => {
    test('should integrate with hook system', async () => {
      await monitoring.initialize();
      
      const mockHooks = {
        getCircuitBreakerState: jest.fn().mockReturnValue('closed')
      };
      
      expect(() => {
        monitoring.integrateWithHooks(mockHooks as any);
      }).not.toThrow();
    });
  });
  
  describe('integration with cache', () => {
    test('should integrate with cache system', async () => {
      await monitoring.initialize();
      
      const mockCache = {
        size: jest.fn().mockResolvedValue(50),
        getStats: jest.fn().mockResolvedValue({
          l1: { size: 10, hitRate: 0.8 },
          l2: { size: 20, hitRate: 0.9 },
          l3: { size: 20, hitRate: 0.95 }
        })
      };
      
      expect(() => {
        monitoring.integrateWithCache(mockCache as any);
      }).not.toThrow();
    });
  });
  
  describe('metrics recording workflow', () => {
    test('should record complete memory operation workflow', async () => {
      await monitoring.initialize();
      
      const metrics = monitoring.getMetrics();
      const instrumentation = monitoring.getInstrumentation();
      const logger = monitoring.getLogger();
      
      // Test memory capture workflow
      expect(() => {
        metrics.recordMemoryCapture('code_write', 'success', 'workspace-1');
        logger.logMemoryOperation('capture', 'success', {
          workspaceId: 'workspace-1',
          eventType: 'code_write',
          duration: 50
        });
      }).not.toThrow();
      
      // Test memory retrieval workflow  
      expect(() => {
        metrics.recordMemoryRetrieval('semantic', 'success', 'workspace-1');
        logger.logMemoryOperation('retrieve', 'success', {
          workspaceId: 'workspace-1',
          query: 'test query',
          duration: 120
        });
      }).not.toThrow();
      
      // Test context building workflow
      expect(() => {
        metrics.recordContextBuild('success', 'workspace-1');
        logger.logMemoryOperation('build_context', 'success', {
          workspaceId: 'workspace-1',
          duration: 80
        });
      }).not.toThrow();
    });
    
    test('should record error scenarios', async () => {
      await monitoring.initialize();
      
      const metrics = monitoring.getMetrics();
      const logger = monitoring.getLogger();
      
      const testError = new Error('Test storage error');
      
      expect(() => {
        metrics.recordError('storage_query', 'connection_timeout');
        metrics.recordMemoryCapture('code_write', 'error', 'workspace-1');
        
        logger.logMemoryOperation('capture', 'error', {
          workspaceId: 'workspace-1',
          eventType: 'code_write',
          error: testError
        });
      }).not.toThrow();
    });
  });
  
  describe('health check integration', () => {
    test('should perform comprehensive health check', async () => {
      await monitoring.initialize();
      
      const healthCheck = monitoring.getHealthCheck();
      
      const result = await healthCheck.performHealthCheck();
      
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('components');
      expect(result).toHaveProperty('metrics');
      
      // Should have default system health checks
      expect(result.components).toHaveProperty('memory');
      expect(result.components).toHaveProperty('cpu');
      expect(result.components).toHaveProperty('uptime');
      
      expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status);
    });
  });
  
  describe('alert system integration', () => {
    test('should have default alert rules registered', async () => {
      await monitoring.initialize();
      
      const alertManager = monitoring.getAlertManager();
      const ruleStatus = alertManager.getRuleStatus();
      
      expect(ruleStatus.length).toBeGreaterThan(0);
      
      // Should have default rules
      const ruleNames = ruleStatus.map(rule => rule.name);
      expect(ruleNames).toContain('high_memory_usage');
    });
    
    test('should check alert rules', async () => {
      await monitoring.initialize();
      
      const alertManager = monitoring.getAlertManager();
      
      await expect(alertManager.checkRules()).resolves.not.toThrow();
    });
  });
  
  describe('graceful shutdown', () => {
    test('should shutdown gracefully', async () => {
      await monitoring.initialize();
      
      await expect(monitoring.shutdown()).resolves.not.toThrow();
    });
    
    test('should handle shutdown errors gracefully', async () => {
      await monitoring.initialize();
      
      // Force an error during shutdown by mocking
      const alertManager = monitoring.getAlertManager();
      alertManager.stopChecking = jest.fn().mockImplementation(() => {
        throw new Error('Shutdown error');
      });
      
      await expect(monitoring.shutdown()).rejects.toThrow();
    });
  });
  
  describe('performance and memory usage', () => {
    test('should not leak memory during normal operation', async () => {
      await monitoring.initialize();
      
      const initialMemory = process.memoryUsage().heapUsed;
      const metrics = monitoring.getMetrics();
      
      // Simulate heavy usage
      for (let i = 0; i < 1000; i++) {
        metrics.recordMemoryCapture('test_event', 'success', `workspace-${i % 10}`);
        metrics.recordOperationDuration('test_operation', Math.random() * 100, 'success');
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable (less than 10MB for 1000 operations)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });
});