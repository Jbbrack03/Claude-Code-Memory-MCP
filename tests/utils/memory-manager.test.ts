import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MemoryManager } from '../../src/utils/memory-manager.js';
import { EventEmitter } from 'events';

describe('MemoryManager', () => {
  let memoryManager: MemoryManager;
  let originalMemoryUsage: typeof process.memoryUsage;
  let mockMemoryUsage: jest.Mock;

  beforeEach(() => {
    // Mock process.memoryUsage to control memory readings
    originalMemoryUsage = process.memoryUsage;
    mockMemoryUsage = jest.fn();
    process.memoryUsage = mockMemoryUsage;

    // Reset singleton instance if it exists
    if ('instance' in MemoryManager) {
      (MemoryManager as any).instance = undefined;
    }

    memoryManager = MemoryManager.getInstance();
  });

  afterEach(() => {
    // Restore original memory usage function
    process.memoryUsage = originalMemoryUsage;
    
    // Stop monitoring to clean up any intervals
    memoryManager.stopMonitoring();
    
    // Clear all handlers
    memoryManager.clearHandlers();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = MemoryManager.getInstance();
      const instance2 = MemoryManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Memory Usage Monitoring', () => {
    it('should monitor heap usage at configured intervals', async () => {
      // Given: Mock memory usage returns increasing values
      mockMemoryUsage
        .mockReturnValueOnce({
          heapUsed: 100 * 1024 * 1024, // 100MB
          heapTotal: 512 * 1024 * 1024,
          rss: 200 * 1024 * 1024,
          external: 10 * 1024 * 1024,
          arrayBuffers: 5 * 1024 * 1024
        })
        .mockReturnValueOnce({
          heapUsed: 200 * 1024 * 1024, // 200MB
          heapTotal: 512 * 1024 * 1024,
          rss: 300 * 1024 * 1024,
          external: 10 * 1024 * 1024,
          arrayBuffers: 5 * 1024 * 1024
        });

      // When: Start monitoring with a short interval
      memoryManager.startMonitoring({ checkInterval: 50 });

      // Then: Memory usage should be checked multiple times
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(mockMemoryUsage).toHaveBeenCalledTimes(3); // Initial + 2 interval checks
    });

    it('should not start monitoring if already running', () => {
      // Given: Monitoring is already started
      memoryManager.startMonitoring({ checkInterval: 100 });
      const initialCallCount = mockMemoryUsage.mock.calls.length;

      // When: Try to start monitoring again
      memoryManager.startMonitoring({ checkInterval: 100 });

      // Then: Should not create additional monitoring
      expect(mockMemoryUsage.mock.calls.length).toBe(initialCallCount);
    });

    it('should stop monitoring when requested', async () => {
      // Given: Monitoring is started
      mockMemoryUsage.mockReturnValue({
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 512 * 1024 * 1024,
        rss: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      memoryManager.startMonitoring({ checkInterval: 50 });

      // When: Stop monitoring
      await new Promise(resolve => setTimeout(resolve, 75));
      const callCountBeforeStop = mockMemoryUsage.mock.calls.length;
      memoryManager.stopMonitoring();

      // Then: No additional checks should occur
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(mockMemoryUsage.mock.calls.length).toBe(callCountBeforeStop);
    });
  });

  describe('Threshold Detection and Event Emission', () => {
    it('should emit low memory pressure event when threshold exceeded', async () => {
      // Given: Event listener for memory pressure
      const lowPressureHandler = jest.fn();
      memoryManager.on('memoryPressure', lowPressureHandler);

      // Mock memory at 65% usage (above default low threshold of 60%)
      mockMemoryUsage.mockReturnValue({
        heapUsed: 332 * 1024 * 1024, // 332MB of 512MB = 65%
        heapTotal: 512 * 1024 * 1024,
        rss: 400 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring
      memoryManager.startMonitoring({ checkInterval: 50 });

      // Then: Low pressure event should be emitted
      await new Promise(resolve => setTimeout(resolve, 75));
      expect(lowPressureHandler).toHaveBeenCalledWith({
        level: 'low',
        usage: expect.objectContaining({
          heapUsedMB: 332,
          heapTotalMB: 512,
          heapUsedPercent: 64.84375
        })
      });
    });

    it('should emit medium memory pressure event when threshold exceeded', async () => {
      // Given: Event listener for memory pressure
      const mediumPressureHandler = jest.fn();
      memoryManager.on('memoryPressure', mediumPressureHandler);

      // Mock memory at 82% usage (above default medium threshold of 80%)
      mockMemoryUsage.mockReturnValue({
        heapUsed: 420 * 1024 * 1024, // 420MB of 512MB = 82%
        heapTotal: 512 * 1024 * 1024,
        rss: 500 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring
      memoryManager.startMonitoring({ checkInterval: 50 });

      // Then: Medium pressure event should be emitted
      await new Promise(resolve => setTimeout(resolve, 75));
      expect(mediumPressureHandler).toHaveBeenCalledWith({
        level: 'medium',
        usage: expect.objectContaining({
          heapUsedMB: 420,
          heapTotalMB: 512,
          heapUsedPercent: 82.03125
        })
      });
    });

    it('should emit high memory pressure event when threshold exceeded', async () => {
      // Given: Event listener for memory pressure
      const highPressureHandler = jest.fn();
      memoryManager.on('memoryPressure', highPressureHandler);

      // Mock memory at 92% usage (above default high threshold of 90%)
      mockMemoryUsage.mockReturnValue({
        heapUsed: 471 * 1024 * 1024, // 471MB of 512MB = 92%
        heapTotal: 512 * 1024 * 1024,
        rss: 600 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring
      memoryManager.startMonitoring({ checkInterval: 50 });

      // Then: High pressure event should be emitted
      await new Promise(resolve => setTimeout(resolve, 75));
      expect(highPressureHandler).toHaveBeenCalledWith({
        level: 'high',
        usage: expect.objectContaining({
          heapUsedMB: 471,
          heapTotalMB: 512,
          heapUsedPercent: 91.9921875
        })
      });
    });

    it('should use custom thresholds when configured', async () => {
      // Given: Custom thresholds and event listener
      const pressureHandler = jest.fn();
      memoryManager.on('memoryPressure', pressureHandler);

      // Mock memory at 55% usage
      mockMemoryUsage.mockReturnValue({
        heapUsed: 282 * 1024 * 1024, // 282MB of 512MB = 55%
        heapTotal: 512 * 1024 * 1024,
        rss: 350 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring with custom low threshold of 50%
      memoryManager.startMonitoring({
        checkInterval: 50,
        thresholds: {
          low: 0.5,
          medium: 0.7,
          high: 0.85
        }
      });

      // Then: Low pressure event should be emitted with custom threshold
      await new Promise(resolve => setTimeout(resolve, 75));
      expect(pressureHandler).toHaveBeenCalledWith({
        level: 'low',
        usage: expect.any(Object)
      });
    });

    it('should not emit duplicate events for same pressure level', async () => {
      // Given: Event listener and consistent high memory usage
      const pressureHandler = jest.fn();
      memoryManager.on('memoryPressure', pressureHandler);

      mockMemoryUsage.mockReturnValue({
        heapUsed: 471 * 1024 * 1024, // Consistently 92%
        heapTotal: 512 * 1024 * 1024,
        rss: 600 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring and wait for multiple checks
      memoryManager.startMonitoring({ checkInterval: 50 });
      await new Promise(resolve => setTimeout(resolve, 200));

      // Then: Should only emit one event for high pressure
      const highPressureEvents = pressureHandler.mock.calls.filter(
        call => call[0].level === 'high'
      );
      expect(highPressureEvents).toHaveLength(1);
    });

    it('should emit recovery event when memory pressure decreases', async () => {
      // Given: Event listener and changing memory usage
      const pressureHandler = jest.fn();
      memoryManager.on('memoryPressure', pressureHandler);

      // Start with high usage
      mockMemoryUsage.mockReturnValueOnce({
        heapUsed: 471 * 1024 * 1024, // 92%
        heapTotal: 512 * 1024 * 1024,
        rss: 600 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // Then drop to normal usage
      mockMemoryUsage.mockReturnValue({
        heapUsed: 256 * 1024 * 1024, // 50%
        heapTotal: 512 * 1024 * 1024,
        rss: 300 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring
      memoryManager.startMonitoring({ checkInterval: 50 });

      // Then: Should emit high pressure then recovery
      await new Promise(resolve => setTimeout(resolve, 150));
      const events = pressureHandler.mock.calls.map(call => call[0].level);
      expect(events).toContain('high');
      expect(events).toContain('normal');
    });
  });

  describe('Garbage Collection', () => {
    it('should trigger garbage collection when available and under pressure', async () => {
      // Given: Garbage collection is available
      const mockGC = jest.fn();
      (global as any).gc = mockGC;

      // Mock high memory usage
      mockMemoryUsage.mockReturnValue({
        heapUsed: 471 * 1024 * 1024, // 92%
        heapTotal: 512 * 1024 * 1024,
        rss: 600 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring with GC enabled
      memoryManager.startMonitoring({
        checkInterval: 50,
        enableGC: true
      });

      // Then: GC should be triggered
      await new Promise(resolve => setTimeout(resolve, 75));
      expect(mockGC).toHaveBeenCalled();

      // Cleanup
      delete (global as any).gc;
    });

    it('should not trigger GC when disabled', async () => {
      // Given: Garbage collection is available but disabled
      const mockGC = jest.fn();
      (global as any).gc = mockGC;

      // Mock high memory usage
      mockMemoryUsage.mockReturnValue({
        heapUsed: 471 * 1024 * 1024, // 92%
        heapTotal: 512 * 1024 * 1024,
        rss: 600 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring with GC disabled
      memoryManager.startMonitoring({
        checkInterval: 50,
        enableGC: false
      });

      // Then: GC should not be triggered
      await new Promise(resolve => setTimeout(resolve, 75));
      expect(mockGC).not.toHaveBeenCalled();

      // Cleanup
      delete (global as any).gc;
    });

    it('should handle absence of global.gc gracefully', async () => {
      // Given: No global.gc available
      delete (global as any).gc;

      // Mock high memory usage
      mockMemoryUsage.mockReturnValue({
        heapUsed: 471 * 1024 * 1024, // 92%
        heapTotal: 512 * 1024 * 1024,
        rss: 600 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring with GC enabled
      // Then: Should not throw
      expect(() => {
        memoryManager.startMonitoring({
          checkInterval: 50,
          enableGC: true
        });
      }).not.toThrow();
    });
  });

  describe('Cleanup Handler Management', () => {
    it('should register cleanup handlers for components', () => {
      // Given: Cleanup handlers
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      // When: Register handlers
      memoryManager.registerHandler('cache', handler1, { priority: 1 });
      memoryManager.registerHandler('vectorStore', handler2, { priority: 2 });

      // Then: Handlers should be registered
      expect(memoryManager.getHandlers()).toHaveLength(2);
    });

    it('should execute handlers in priority order during memory pressure', async () => {
      // Given: Multiple handlers with different priorities
      const executionOrder: string[] = [];
      const handler1 = jest.fn(() => executionOrder.push('low-priority'));
      const handler2 = jest.fn(() => executionOrder.push('high-priority'));
      const handler3 = jest.fn(() => executionOrder.push('medium-priority'));

      memoryManager.registerHandler('component1', handler1, { priority: 1 });
      memoryManager.registerHandler('component2', handler2, { priority: 3 });
      memoryManager.registerHandler('component3', handler3, { priority: 2 });

      // Mock high memory usage
      mockMemoryUsage.mockReturnValue({
        heapUsed: 471 * 1024 * 1024, // 92%
        heapTotal: 512 * 1024 * 1024,
        rss: 600 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Trigger memory pressure
      memoryManager.startMonitoring({ checkInterval: 50 });
      await new Promise(resolve => setTimeout(resolve, 75));

      // Then: Handlers should execute in priority order (highest first)
      expect(executionOrder).toEqual(['high-priority', 'medium-priority', 'low-priority']);
    });

    it('should only execute handlers for appropriate pressure levels', async () => {
      // Given: Handlers for different levels
      const lowHandler = jest.fn();
      const mediumHandler = jest.fn();
      const highHandler = jest.fn();

      memoryManager.registerHandler('lowComponent', lowHandler, { 
        priority: 1, 
        level: 'low' 
      });
      memoryManager.registerHandler('mediumComponent', mediumHandler, { 
        priority: 1, 
        level: 'medium' 
      });
      memoryManager.registerHandler('highComponent', highHandler, { 
        priority: 1, 
        level: 'high' 
      });

      // Mock medium memory usage
      mockMemoryUsage.mockReturnValue({
        heapUsed: 420 * 1024 * 1024, // 82%
        heapTotal: 512 * 1024 * 1024,
        rss: 500 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Trigger medium memory pressure
      memoryManager.startMonitoring({ checkInterval: 50 });
      await new Promise(resolve => setTimeout(resolve, 75));

      // Then: Only low and medium handlers should execute
      expect(lowHandler).toHaveBeenCalled();
      expect(mediumHandler).toHaveBeenCalled();
      expect(highHandler).not.toHaveBeenCalled();
    });

    it('should handle errors in cleanup handlers gracefully', async () => {
      // Given: Handler that throws error and another that succeeds
      const errorHandler = jest.fn(() => {
        throw new Error('Cleanup failed');
      });
      const successHandler = jest.fn();
      const errorListener = jest.fn();

      memoryManager.on('error', errorListener);
      memoryManager.registerHandler('errorComponent', errorHandler, { priority: 2 });
      memoryManager.registerHandler('successComponent', successHandler, { priority: 1 });

      // Mock high memory usage
      mockMemoryUsage.mockReturnValue({
        heapUsed: 471 * 1024 * 1024, // 92%
        heapTotal: 512 * 1024 * 1024,
        rss: 600 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Trigger memory pressure
      memoryManager.startMonitoring({ checkInterval: 50 });
      await new Promise(resolve => setTimeout(resolve, 75));

      // Then: Error should be emitted but other handler should still execute
      expect(errorListener).toHaveBeenCalledWith({
        error: expect.any(Error),
        handler: 'errorComponent'
      });
      expect(successHandler).toHaveBeenCalled();
    });

    it('should allow unregistering handlers', () => {
      // Given: Registered handler
      const handler = jest.fn();
      memoryManager.registerHandler('cache', handler);

      // When: Unregister handler
      memoryManager.unregisterHandler('cache');

      // Then: Handler should be removed
      expect(memoryManager.getHandlers()).toHaveLength(0);
    });

    it('should clear all handlers when requested', () => {
      // Given: Multiple registered handlers
      memoryManager.registerHandler('cache', jest.fn());
      memoryManager.registerHandler('vectorStore', jest.fn());
      memoryManager.registerHandler('fileStore', jest.fn());

      // When: Clear all handlers
      memoryManager.clearHandlers();

      // Then: All handlers should be removed
      expect(memoryManager.getHandlers()).toHaveLength(0);
    });
  });

  describe('Memory Statistics', () => {
    it('should provide current memory usage statistics', () => {
      // Given: Mock memory usage
      mockMemoryUsage.mockReturnValue({
        heapUsed: 332 * 1024 * 1024,
        heapTotal: 512 * 1024 * 1024,
        rss: 400 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Get statistics
      const stats = memoryManager.getStatistics();

      // Then: Should return formatted statistics
      expect(stats).toEqual({
        current: {
          heapUsedMB: 332,
          heapTotalMB: 512,
          heapUsedPercent: 64.84375,
          rssMB: 400,
          externalMB: 10,
          arrayBuffersMB: 5
        },
        thresholds: {
          low: 0.6,
          medium: 0.8,
          high: 0.9
        },
        pressure: 'low',
        handlersRegistered: 0,
        monitoring: false
      });
    });

    it('should track historical memory usage', async () => {
      // Given: Mock changing memory usage
      let heapUsed = 100 * 1024 * 1024;
      mockMemoryUsage.mockImplementation(() => {
        heapUsed += 50 * 1024 * 1024;
        return {
          heapUsed,
          heapTotal: 512 * 1024 * 1024,
          rss: 200 * 1024 * 1024,
          external: 10 * 1024 * 1024,
          arrayBuffers: 5 * 1024 * 1024
        };
      });

      // When: Monitor for a period
      memoryManager.startMonitoring({ 
        checkInterval: 50,
        trackHistory: true,
        historySize: 5
      });
      await new Promise(resolve => setTimeout(resolve, 275));

      // Then: Should have historical data
      const stats = memoryManager.getStatistics();
      expect(stats.history).toBeDefined();
      expect(stats.history!.length).toBeGreaterThan(0);
      expect(stats.history!.length).toBeLessThanOrEqual(5);
      expect(stats.history![0]).toHaveProperty('timestamp');
      expect(stats.history![0]).toHaveProperty('heapUsedMB');
    });

    it('should calculate memory trends', async () => {
      // Given: Mock increasing memory usage
      let heapUsed = 100 * 1024 * 1024;
      mockMemoryUsage.mockImplementation(() => {
        heapUsed += 25 * 1024 * 1024;
        return {
          heapUsed,
          heapTotal: 512 * 1024 * 1024,
          rss: 200 * 1024 * 1024,
          external: 10 * 1024 * 1024,
          arrayBuffers: 5 * 1024 * 1024
        };
      });

      // When: Monitor with trend analysis
      memoryManager.startMonitoring({ 
        checkInterval: 50,
        trackHistory: true,
        analyzeTrends: true
      });
      await new Promise(resolve => setTimeout(resolve, 200));

      // Then: Should provide trend information
      const stats = memoryManager.getStatistics();
      expect(stats.trend).toBeDefined();
      expect(stats.trend).toBe('increasing');
    });
  });

  describe('Graceful Degradation', () => {
    it('should support degradation strategies for different pressure levels', async () => {
      // Given: Degradation strategy
      const degradationHandler = jest.fn();
      memoryManager.on('degradation', degradationHandler);

      // Mock high memory usage
      mockMemoryUsage.mockReturnValue({
        heapUsed: 471 * 1024 * 1024, // 92%
        heapTotal: 512 * 1024 * 1024,
        rss: 600 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring with degradation enabled
      memoryManager.startMonitoring({ 
        checkInterval: 50,
        enableDegradation: true
      });
      await new Promise(resolve => setTimeout(resolve, 75));

      // Then: Degradation event should be emitted
      expect(degradationHandler).toHaveBeenCalledWith({
        level: 'high',
        suggestions: expect.arrayContaining([
          'disable-caching',
          'reduce-batch-sizes',
          'pause-background-tasks'
        ])
      });
    });

    it('should provide different suggestions for each pressure level', async () => {
      // Given: Degradation listener
      const degradationHandler = jest.fn();
      memoryManager.on('degradation', degradationHandler);

      // Test low pressure
      mockMemoryUsage.mockReturnValueOnce({
        heapUsed: 332 * 1024 * 1024, // 65%
        heapTotal: 512 * 1024 * 1024,
        rss: 400 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring
      memoryManager.startMonitoring({ 
        checkInterval: 50,
        enableDegradation: true
      });
      await new Promise(resolve => setTimeout(resolve, 75));

      // Then: Should suggest light degradation
      expect(degradationHandler).toHaveBeenCalledWith({
        level: 'low',
        suggestions: expect.arrayContaining([
          'reduce-cache-ttl',
          'limit-concurrent-operations'
        ])
      });
    });

    it('should allow custom degradation strategies', async () => {
      // Given: Custom degradation strategy
      const customStrategy = jest.fn((level) => {
        return [`custom-action-for-${level}`];
      });
      
      const degradationHandler = jest.fn();
      memoryManager.on('degradation', degradationHandler);

      // Mock medium memory usage
      mockMemoryUsage.mockReturnValue({
        heapUsed: 420 * 1024 * 1024, // 82%
        heapTotal: 512 * 1024 * 1024,
        rss: 500 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      // When: Start monitoring with custom strategy
      memoryManager.startMonitoring({ 
        checkInterval: 50,
        enableDegradation: true,
        degradationStrategy: customStrategy
      });
      await new Promise(resolve => setTimeout(resolve, 75));

      // Then: Custom strategy should be used
      expect(customStrategy).toHaveBeenCalledWith('medium');
      expect(degradationHandler).toHaveBeenCalledWith({
        level: 'medium',
        suggestions: ['custom-action-for-medium']
      });
    });
  });

  describe('Configuration', () => {
    it('should validate threshold configuration', () => {
      // Given: Invalid threshold configuration
      const invalidConfigs = [
        { low: 0.9, medium: 0.8, high: 0.7 }, // Wrong order
        { low: -0.1, medium: 0.8, high: 0.9 }, // Negative value
        { low: 0.6, medium: 1.2, high: 0.9 }, // Value > 1
        { low: 0.6, medium: 0.6, high: 0.9 }, // Same values
      ];

      // When/Then: Should throw for invalid configurations
      invalidConfigs.forEach(config => {
        expect(() => {
          memoryManager.startMonitoring({
            checkInterval: 100,
            thresholds: config
          });
        }).toThrow();
      });
    });

    it('should accept valid threshold configuration', () => {
      // Given: Valid threshold configuration
      const validConfig = {
        low: 0.5,
        medium: 0.7,
        high: 0.85
      };

      // When/Then: Should not throw
      expect(() => {
        memoryManager.startMonitoring({
          checkInterval: 100,
          thresholds: validConfig
        });
      }).not.toThrow();
    });

    it('should validate check interval', () => {
      // Given: Invalid check intervals
      const invalidIntervals = [0, -100, NaN];

      // When/Then: Should throw for invalid intervals
      invalidIntervals.forEach(interval => {
        expect(() => {
          memoryManager.startMonitoring({
            checkInterval: interval
          });
        }).toThrow();
      });
    });

    it('should use sensible defaults when not configured', () => {
      // When: Start monitoring without configuration
      memoryManager.startMonitoring();

      // Then: Should use default values
      const stats = memoryManager.getStatistics();
      expect(stats.thresholds).toEqual({
        low: 0.6,
        medium: 0.8,
        high: 0.9
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete lifecycle with multiple handlers', async () => {
      // Given: Multiple handlers and listeners
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const pressureListener = jest.fn();
      const degradationListener = jest.fn();

      memoryManager.registerHandler('cache', handler1, { priority: 1, level: 'low' });
      memoryManager.registerHandler('vectorStore', handler2, { priority: 2, level: 'medium' });
      memoryManager.on('memoryPressure', pressureListener);
      memoryManager.on('degradation', degradationListener);

      // Simulate memory increase
      let heapUsed = 256 * 1024 * 1024; // Start at 50%
      mockMemoryUsage.mockImplementation(() => {
        const result = {
          heapUsed,
          heapTotal: 512 * 1024 * 1024,
          rss: heapUsed + 100 * 1024 * 1024,
          external: 10 * 1024 * 1024,
          arrayBuffers: 5 * 1024 * 1024
        };
        heapUsed += 51 * 1024 * 1024; // Increase by 10% each time
        return result;
      });

      // When: Monitor memory
      memoryManager.startMonitoring({
        checkInterval: 50,
        enableDegradation: true,
        enableGC: true,
        trackHistory: true
      });

      // Wait for multiple checks
      await new Promise(resolve => setTimeout(resolve, 300));

      // Then: Should have complete lifecycle
      expect(pressureListener).toHaveBeenCalled();
      expect(handler1).toHaveBeenCalled(); // Low threshold handler
      expect(handler2).toHaveBeenCalled(); // Medium threshold handler
      expect(degradationListener).toHaveBeenCalled();
      
      const stats = memoryManager.getStatistics();
      expect(stats.monitoring).toBe(true);
      expect(stats.handlersRegistered).toBe(2);
      expect(stats.history).toBeDefined();
      expect(stats.history!.length).toBeGreaterThan(0);
    });

    it('should recover gracefully from monitoring errors', async () => {
      // Given: Memory usage that throws occasionally
      let callCount = 0;
      mockMemoryUsage.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Memory read failed');
        }
        return {
          heapUsed: 256 * 1024 * 1024,
          heapTotal: 512 * 1024 * 1024,
          rss: 300 * 1024 * 1024,
          external: 10 * 1024 * 1024,
          arrayBuffers: 5 * 1024 * 1024
        };
      });

      const errorListener = jest.fn();
      memoryManager.on('error', errorListener);

      // When: Start monitoring
      memoryManager.startMonitoring({ checkInterval: 50 });
      await new Promise(resolve => setTimeout(resolve, 200));

      // Then: Should emit error but continue monitoring
      expect(errorListener).toHaveBeenCalledWith({
        error: expect.any(Error),
        context: 'monitoring'
      });
      expect(callCount).toBeGreaterThan(2); // Should continue after error
    });
  });
});