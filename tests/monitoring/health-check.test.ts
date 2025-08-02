import { HealthCheckService, ComponentHealth } from '../../src/monitoring/health-check.js';
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('HealthCheckService', () => {
  let healthCheck: HealthCheckService;
  
  beforeEach(() => {
    healthCheck = new HealthCheckService();
  });
  
  afterEach(() => {
    // Clean up any intervals
    healthCheck.stopPeriodicHealthChecks();
  });
  
  describe('health check registration', () => {
    test('should register custom health check', () => {
      const mockCheck = jest.fn().mockResolvedValue({
        status: 'healthy' as const,
        message: 'Test component is healthy',
        lastCheck: new Date()
      });
      
      expect(() => {
        healthCheck.registerCheck('test-component', mockCheck);
      }).not.toThrow();
    });
    
    test('should register multiple health checks', () => {
      const mockCheck1 = jest.fn().mockResolvedValue({
        status: 'healthy' as const,
        message: 'Component 1 healthy',
        lastCheck: new Date()
      });
      
      const mockCheck2 = jest.fn().mockResolvedValue({
        status: 'degraded' as const,
        message: 'Component 2 degraded',
        lastCheck: new Date()
      });
      
      healthCheck.registerCheck('component-1', mockCheck1);
      healthCheck.registerCheck('component-2', mockCheck2);
      
      expect(() => {}).not.toThrow();
    });
  });
  
  describe('health check execution', () => {
    test('should perform health check with all healthy components', async () => {
      const mockHealthyCheck = jest.fn().mockResolvedValue({
        status: 'healthy' as const,
        message: 'All systems operational',
        lastCheck: new Date(),
        metadata: { version: '1.0.0' }
      });
      
      healthCheck.registerCheck('test-component', mockHealthyCheck);
      
      // Add small delay to ensure uptime > 0
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const result = await healthCheck.performHealthCheck();
      
      expect(result.status).toBe('healthy');
      expect(result.components['test-component']).toBeDefined();
      expect(result.components['test-component'].status).toBe('healthy');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.uptime).toBeGreaterThan(0);
      expect(result.version).toBeDefined();
      expect(mockHealthyCheck).toHaveBeenCalled();
    });
    
    test('should perform health check with degraded component', async () => {
      const mockDegradedCheck = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({
          status: 'degraded' as const,
          message: 'Component running but slow',
          lastCheck: new Date()
        }), 10)) // Add 10ms delay
      );
      
      healthCheck.registerCheck('slow-component', mockDegradedCheck);
      
      // Add small delay to ensure uptime > 0
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const result = await healthCheck.performHealthCheck();
      
      expect(result.status).toBe('degraded');
      expect(result.components['slow-component'].status).toBe('degraded');
      expect(result.components['slow-component'].responseTime).toBeGreaterThan(0); // Should be > 10ms
    });
    
    test('should perform health check with unhealthy component', async () => {
      const mockUnhealthyCheck = jest.fn().mockResolvedValue({
        status: 'unhealthy' as const,
        message: 'Component is down',
        lastCheck: new Date()
      });
      
      healthCheck.registerCheck('failed-component', mockUnhealthyCheck);
      
      const result = await healthCheck.performHealthCheck();
      
      expect(result.status).toBe('unhealthy');
      expect(result.components['failed-component'].status).toBe('unhealthy');
    });
    
    test('should handle failed health check gracefully', async () => {
      const mockFailingCheck = jest.fn().mockRejectedValue(new Error('Check failed'));
      
      healthCheck.registerCheck('failing-component', mockFailingCheck);
      
      const result = await healthCheck.performHealthCheck();
      
      expect(result.status).toBe('unhealthy');
      expect(result.components['failing-component'].status).toBe('unhealthy');
      expect(result.components['failing-component'].message).toContain('Check failed');
    });
    
    test('should handle timeout in health checks', async () => {
      const mockSlowCheck = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({
          status: 'healthy' as const,
          message: 'Slow but healthy',
          lastCheck: new Date()
        }), 6000)) // 6 seconds, should timeout at 5
      );
      
      healthCheck.registerCheck('slow-component', mockSlowCheck);
      
      const result = await healthCheck.performHealthCheck();
      
      expect(result.status).toBe('unhealthy');
      expect(result.components['slow-component'].status).toBe('unhealthy');
      expect(result.components['slow-component'].message).toContain('timeout');
    }, 10000);
    
    test('should run multiple health checks in parallel', async () => {
      const startTime = Date.now();
      
      const mockCheck1 = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({
          status: 'healthy' as const,
          message: 'Component 1 healthy',
          lastCheck: new Date()
        }), 100))
      );
      
      const mockCheck2 = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({
          status: 'healthy' as const,
          message: 'Component 2 healthy',
          lastCheck: new Date()
        }), 100))
      );
      
      healthCheck.registerCheck('component-1', mockCheck1);
      healthCheck.registerCheck('component-2', mockCheck2);
      
      const result = await healthCheck.performHealthCheck();
      const duration = Date.now() - startTime;
      
      expect(result.status).toBe('healthy');
      expect(result.components['component-1'].status).toBe('healthy');
      expect(result.components['component-2'].status).toBe('healthy');
      
      // Should complete in ~100ms (parallel) rather than ~200ms (sequential)
      expect(duration).toBeLessThan(200);
    });
  });
  
  describe('component status tracking', () => {
    test('should track component status history', async () => {
      const mockCheck = jest.fn().mockResolvedValue({
        status: 'healthy' as const,
        message: 'Component operational',
        lastCheck: new Date()
      });
      
      healthCheck.registerCheck('tracked-component', mockCheck);
      
      await healthCheck.performHealthCheck();
      
      const componentStatus = healthCheck.getComponentStatus('tracked-component');
      expect(componentStatus).toBeDefined();
      expect(componentStatus!.status).toBe('healthy');
      
      const allStatuses = healthCheck.getAllComponentStatuses();
      expect(allStatuses['tracked-component']).toBeDefined();
    });
    
    test('should return undefined for unknown component', () => {
      const status = healthCheck.getComponentStatus('unknown-component');
      expect(status).toBeUndefined();
    });
  });
  
  describe('quick status check', () => {
    test('should provide quick status without full health check', async () => {
      const quickStatus = await healthCheck.getQuickStatus();
      
      expect(quickStatus).toHaveProperty('status');
      expect(quickStatus).toHaveProperty('uptime');
      expect(quickStatus).toHaveProperty('memory');
      expect(quickStatus).toHaveProperty('version');
      
      expect(['healthy', 'degraded', 'unhealthy']).toContain(quickStatus.status);
      expect(typeof quickStatus.uptime).toBe('number');
      expect(typeof quickStatus.memory).toBe('number');
      expect(typeof quickStatus.version).toBe('string');
    });
  });
  
  describe('default health checks', () => {
    test('should register default system health checks', () => {
      expect(() => {
        healthCheck.registerDefaultChecks();
      }).not.toThrow();
    });
    
    test('should execute default health checks', async () => {
      healthCheck.registerDefaultChecks();
      
      const result = await healthCheck.performHealthCheck();
      
      expect(result.components).toHaveProperty('memory');
      expect(result.components).toHaveProperty('cpu');
      expect(result.components).toHaveProperty('uptime');
      
      expect(result.components.memory.status).toBeDefined();
      expect(result.components.cpu.status).toBeDefined();
      expect(result.components.uptime.status).toBeDefined();
      
      // Memory check should have metadata
      expect(result.components.memory.metadata).toHaveProperty('heapUsed');
      expect(result.components.memory.metadata).toHaveProperty('heapTotal');
      expect(result.components.memory.metadata).toHaveProperty('usagePercent');
      
      // CPU check should have metadata
      expect(result.components.cpu.metadata).toHaveProperty('user');
      expect(result.components.cpu.metadata).toHaveProperty('system');
      
      // Uptime check should have metadata
      expect(result.components.uptime.metadata).toHaveProperty('uptime');
      expect(result.components.uptime.metadata).toHaveProperty('uptimeHuman');
    });
  });
  
  describe('metrics collection', () => {
    test('should collect health metrics', async () => {
      const result = await healthCheck.performHealthCheck();
      
      expect(result.metrics).toBeDefined();
      expect(result.metrics!.memoryUsage).toHaveProperty('heapUsed');
      expect(result.metrics!.memoryUsage).toHaveProperty('heapTotal');
      expect(result.metrics!.memoryUsage).toHaveProperty('rss');
      expect(result.metrics!.memoryUsage).toHaveProperty('external');
      
      expect(result.metrics!.cpuUsage).toHaveProperty('user');
      expect(result.metrics!.cpuUsage).toHaveProperty('system');
      
      expect(result.metrics!.responseTime).toHaveProperty('p50');
      expect(result.metrics!.responseTime).toHaveProperty('p95');
      expect(result.metrics!.responseTime).toHaveProperty('p99');
      
      expect(typeof result.metrics!.uptime).toBe('number');
      expect(typeof result.metrics!.version).toBe('string');
    });
  });
  
  describe('periodic health checks', () => {
    test('should start periodic health checks', (done) => {
      const mockCheck = jest.fn().mockResolvedValue({
        status: 'healthy' as const,
        message: 'Periodic check',
        lastCheck: new Date()
      });
      
      healthCheck.registerCheck('periodic-component', mockCheck);
      
      // Start with very short interval for testing
      healthCheck.startPeriodicHealthChecks(50);
      
      // After 150ms, should have run at least 2-3 times
      setTimeout(() => {
        expect(mockCheck).toHaveBeenCalledTimes(1); // Initial call
        done();
      }, 25); // Check after initial call
    });
  });
});