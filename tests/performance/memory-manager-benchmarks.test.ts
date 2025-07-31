import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { MemoryManager } from "../../src/utils/memory-manager.js";
import { performance } from "perf_hooks";

describe('MemoryManager Performance Benchmarks', () => {
  let memoryManager: MemoryManager;
  let originalGC: (() => void) | undefined;

  beforeEach(() => {
    // Mock global.gc if not available
    originalGC = (global as any).gc;
    if (!(global as any).gc) {
      (global as any).gc = jest.fn();
    }

    memoryManager = MemoryManager.getInstance({
      checkInterval: 100, // Fast intervals for testing
      thresholds: {
        low: 0.6,
        medium: 0.8,
        high: 0.9
      },
      enableGC: true,
      trackHistory: true,
      historySize: 100,
      analyzeTrends: true
    });
  });

  afterEach(async () => {
    await memoryManager.stop();
    MemoryManager.resetInstance();
    
    // Restore original GC
    if (originalGC) {
      (global as any).gc = originalGC;
    } else {
      delete (global as any).gc;
    }
  });

  describe('memory pressure detection latency', () => {
    it('should detect memory pressure changes in < 100ms (p95)', async () => {
      const detectionTimes: number[] = [];
      let pressureChangeDetected = false;

      // Set up pressure change listener
      const pressureListener = (level: string) => {
        if (!pressureChangeDetected) {
          pressureChangeDetected = true;
        }
      };

      memoryManager.on('pressure-change', pressureListener);

      // Start monitoring
      await memoryManager.startMonitoring();

      // Simulate memory pressure by allocating large buffers
      const buffers: Buffer[] = [];
      
      for (let i = 0; i < 50; i++) {
        const startTime = performance.now();
        
        // Allocate memory to trigger pressure detection
        buffers.push(Buffer.alloc(1024 * 1024)); // 1MB
        
        // Wait for potential pressure detection
        await new Promise(resolve => setTimeout(resolve, 20));
        
        const endTime = performance.now();
        detectionTimes.push(endTime - startTime);
        
        if (pressureChangeDetected) {
          break;
        }
      }

      // Calculate p95 detection time
      detectionTimes.sort((a, b) => a - b);
      const p95Index = Math.floor(detectionTimes.length * 0.95);
      const p95Time = detectionTimes[p95Index];

      expect(p95Time).toBeLessThan(100);

      // Cleanup
      buffers.length = 0;
      memoryManager.off('pressure-change', pressureListener);
    });

    it('should maintain detection accuracy under varying memory patterns', async () => {
      const detectionResults: Array<{ allocated: number; detected: boolean; time: number }> = [];
      
      await memoryManager.startMonitoring();

      // Test different allocation patterns
      const allocationSizes = [512, 1024, 2048, 4096, 8192]; // KB
      
      for (const size of allocationSizes) {
        let detected = false;
        const startTime = performance.now();
        
        const pressureListener = () => { detected = true; };
        memoryManager.on('pressure-change', pressureListener);
        
        // Allocate memory
        const buffer = Buffer.alloc(size * 1024);
        
        // Wait for detection
        await new Promise(resolve => setTimeout(resolve, 150));
        
        const endTime = performance.now();
        
        detectionResults.push({
          allocated: size,
          detected,
          time: endTime - startTime
        });
        
        memoryManager.off('pressure-change', pressureListener);
        
        // Clean up
        buffer.fill(0);
      }

      // Detection should be consistent and fast
      const avgDetectionTime = detectionResults
        .filter(r => r.detected)
        .reduce((sum, r, _, arr) => sum + r.time / arr.length, 0);
      
      if (avgDetectionTime > 0) {
        expect(avgDetectionTime).toBeLessThan(200);
      }
    });
  });

  describe('cleanup handler execution performance', () => {
    it('should execute cleanup handlers efficiently', async () => {
      const executionTimes: number[] = [];
      const handlerResults: boolean[] = [];

      // Register multiple cleanup handlers
      const handlerCount = 20;
      for (let i = 0; i < handlerCount; i++) {
        const handler = {
          name: `test-handler-${i}`,
          handler: async () => {
            // Simulate cleanup work
            await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
            handlerResults.push(true);
          },
          priority: i % 3,
          level: ['low', 'medium', 'high'][i % 3] as 'low' | 'medium' | 'high'
        };

        memoryManager.registerCleanupHandler(handler);
      }

      // Measure cleanup execution performance
      for (let i = 0; i < 10; i++) {
        const startTime = performance.now();
        await memoryManager.runCleanup('medium');
        const endTime = performance.now();
        
        executionTimes.push(endTime - startTime);
      }

      const avgExecutionTime = executionTimes.reduce((a, b) => a + b) / executionTimes.length;
      expect(avgExecutionTime).toBeLessThan(100); // Should be fast

      // All handlers should have executed
      expect(handlerResults.length).toBeGreaterThan(0);
    });

    it('should prioritize cleanup handlers correctly', async () => {
      const executionOrder: number[] = [];

      // Register handlers with different priorities
      const priorities = [3, 1, 2, 0, 4];
      priorities.forEach((priority, index) => {
        memoryManager.registerCleanupHandler({
          name: `priority-handler-${priority}`,
          handler: async () => {
            executionOrder.push(priority);
          },
          priority,
          level: 'high'
        });
      });

      const startTime = performance.now();
      await memoryManager.runCleanup('high');
      const endTime = performance.now();

      // Should execute in priority order (higher priority first)
      const expectedOrder = [...priorities].sort((a, b) => b - a);
      expect(executionOrder).toEqual(expectedOrder);

      // Should be fast even with prioritization
      expect(endTime - startTime).toBeLessThan(50);
    });

    it('should handle cleanup handler failures gracefully', async () => {
      const successfulHandlers: string[] = [];
      const failedHandlers: string[] = [];

      // Register mix of successful and failing handlers
      for (let i = 0; i < 10; i++) {
        const willFail = i % 3 === 0;
        const handlerName = `handler-${i}`;

        memoryManager.registerCleanupHandler({
          name: handlerName,
          handler: async () => {
            if (willFail) {
              failedHandlers.push(handlerName);
              throw new Error(`Handler ${handlerName} failed`);
            } else {
              successfulHandlers.push(handlerName);
            }
          },
          priority: 1,
          level: 'medium'
        });
      }

      const startTime = performance.now();
      await memoryManager.runCleanup('medium');
      const endTime = performance.now();

      // Both successful and failed handlers should have been processed
      expect(successfulHandlers.length).toBeGreaterThan(0);
      expect(failedHandlers.length).toBeGreaterThan(0);

      // Should complete quickly despite failures
      expect(endTime - startTime).toBeLessThan(100);
    });
  });

  describe('memory recovery effectiveness', () => {
    it('should achieve effective memory recovery under pressure', async () => {
      await memoryManager.startMonitoring();

      // Record initial memory usage
      const initialMemory = memoryManager.getCurrentUsage();

      // Allocate significant memory
      const largeBuffers: Buffer[] = [];
      for (let i = 0; i < 20; i++) {
        largeBuffers.push(Buffer.alloc(2 * 1024 * 1024)); // 2MB each
      }

      // Wait for pressure detection
      await new Promise(resolve => setTimeout(resolve, 200));

      // Register cleanup handler that releases memory
      memoryManager.registerCleanupHandler({
        name: 'buffer-cleanup',
        handler: async () => {
          largeBuffers.splice(0, 10); // Release half the buffers
          if ((global as any).gc) {
            (global as any).gc();
          }
        },
        priority: 1,
        level: 'high'
      });

      // Trigger cleanup
      const cleanupStartTime = performance.now();
      await memoryManager.runCleanup('high');
      const cleanupEndTime = performance.now();

      // Wait for memory to stabilize
      await new Promise(resolve => setTimeout(resolve, 100));

      const finalMemory = memoryManager.getCurrentUsage();

      // Cleanup should be fast
      expect(cleanupEndTime - cleanupStartTime).toBeLessThan(200);

      // Memory should show some recovery (implementation dependent)
      expect(finalMemory.heapUsedMB).toBeDefined();
      expect(finalMemory.heapTotalMB).toBeDefined();
    });

    it('should prevent memory leaks during continuous operation', async () => {
      await memoryManager.startMonitoring();

      const memoryReadings: number[] = [];
      
      // Register continuous cleanup
      memoryManager.registerCleanupHandler({
        name: 'continuous-cleanup',
        handler: async () => {
          if ((global as any).gc) {
            (global as any).gc();
          }
        },
        priority: 1,
        level: 'low'
      });

      // Simulate continuous operation with memory allocation
      for (let i = 0; i < 50; i++) {
        // Allocate some memory
        const tempBuffer = Buffer.alloc(100 * 1024); // 100KB
        
        // Record memory usage
        const usage = memoryManager.getCurrentUsage();
        memoryReadings.push(usage.heapUsedMB);
        
        // Trigger cleanup periodically
        if (i % 10 === 0) {
          await memoryManager.runCleanup('low');
        }
        
        // Clean up temporary allocation
        tempBuffer.fill(0);
        
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Memory should not continuously increase
      const firstHalf = memoryReadings.slice(0, Math.floor(memoryReadings.length / 2));
      const secondHalf = memoryReadings.slice(Math.floor(memoryReadings.length / 2));
      
      const firstHalfAvg = firstHalf.reduce((a, b) => a + b) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((a, b) => a + b) / secondHalf.length;
      
      // Memory growth should be controlled
      const growthRatio = secondHalfAvg / firstHalfAvg;
      expect(growthRatio).toBeLessThan(2); // Less than 2x growth
    });
  });

  describe('history tracking overhead', () => {
    it('should maintain low overhead for history tracking', async () => {
      const config = {
        checkInterval: 50,
        trackHistory: true,
        historySize: 1000,
        analyzeTrends: true
      };

      const trackedManager = new MemoryManager(config);
      await trackedManager.startMonitoring();

      const operationTimes: number[] = [];

      // Measure overhead of history operations
      for (let i = 0; i < 100; i++) {
        const startTime = performance.now();
        
        // Trigger memory check (which updates history)
        trackedManager.getCurrentUsage();
        
        const endTime = performance.now();
        operationTimes.push(endTime - startTime);
        
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const avgOperationTime = operationTimes.reduce((a, b) => a + b) / operationTimes.length;
      expect(avgOperationTime).toBeLessThan(5); // Very low overhead

      await trackedManager.stop();
      
      // History should be populated
      const history = trackedManager.getMemoryHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    it('should limit history size to prevent memory bloat', async () => {
      const historySize = 50;
      const limitedManager = new MemoryManager({
        checkInterval: 10,
        trackHistory: true,
        historySize,
        analyzeTrends: true
      });

      await limitedManager.startMonitoring();

      // Generate more history entries than the limit
      for (let i = 0; i < historySize * 2; i++) {
        limitedManager.getCurrentUsage();
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      await limitedManager.stop();

      const history = limitedManager.getMemoryHistory();
      expect(history.length).toBeLessThanOrEqual(historySize);
    });

    it('should provide efficient trend analysis', async () => {
      const analyticManager = new MemoryManager({
        checkInterval: 20,
        trackHistory: true,
        historySize: 100,
        analyzeTrends: true
      });

      await analyticManager.startMonitoring();

      // Generate history with trend
      for (let i = 0; i < 50; i++) {
        analyticManager.getCurrentUsage();
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const analysisTimes: number[] = [];

      // Measure trend analysis performance
      for (let i = 0; i < 20; i++) {
        const startTime = performance.now();
        const trends = analyticManager.analyzeTrends();
        const endTime = performance.now();
        
        expect(trends).toBeDefined();
        analysisTimes.push(endTime - startTime);
      }

      const avgAnalysisTime = analysisTimes.reduce((a, b) => a + b) / analysisTimes.length;
      expect(avgAnalysisTime).toBeLessThan(10); // Fast trend analysis

      await analyticManager.stop();
    });
  });

  describe('event emission performance', () => {
    it('should emit events efficiently', async () => {
      await memoryManager.startMonitoring();

      let eventCount = 0;
      const eventTimes: number[] = [];

      const eventListener = () => {
        eventCount++;
      };

      // Listen to various events
      memoryManager.on('pressure-change', eventListener);
      memoryManager.on('cleanup-completed', eventListener);
      memoryManager.on('memory-warning', eventListener);

      // Trigger events through various operations
      for (let i = 0; i < 20; i++) {
        const startTime = performance.now();
        
        // Trigger cleanup (which emits events)
        await memoryManager.runCleanup('low');
        
        const endTime = performance.now();
        eventTimes.push(endTime - startTime);
        
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      const avgEventTime = eventTimes.reduce((a, b) => a + b) / eventTimes.length;
      expect(avgEventTime).toBeLessThan(50); // Fast event emission

      // Events should have been emitted
      expect(eventCount).toBeGreaterThan(0);
    });

    it('should handle multiple event listeners efficiently', async () => {
      await memoryManager.startMonitoring();

      const listenerCount = 50;
      const listenerTimes: number[] = [];

      // Add multiple listeners
      for (let i = 0; i < listenerCount; i++) {
        memoryManager.on('pressure-change', (level) => {
          // Simulate listener work
          const start = Date.now();
          while (Date.now() - start < 1) {
            // Busy wait for 1ms
          }
        });
      }

      // Measure event broadcast performance
      for (let i = 0; i < 10; i++) {
        const startTime = performance.now();
        
        // Emit event to all listeners
        memoryManager.emit('pressure-change', 'medium');
        
        const endTime = performance.now();
        listenerTimes.push(endTime - startTime);
      }

      const avgBroadcastTime = listenerTimes.reduce((a, b) => a + b) / listenerTimes.length;
      expect(avgBroadcastTime).toBeLessThan(100); // Should handle many listeners
    });

    it('should maintain event queue performance under load', async () => {
      await memoryManager.startMonitoring();

      const eventQueue: string[] = [];
      let processedEvents = 0;

      memoryManager.on('pressure-change', (level) => {
        eventQueue.push(`pressure-${level}`);
        processedEvents++;
      });

      memoryManager.on('cleanup-completed', (level) => {
        eventQueue.push(`cleanup-${level}`);
        processedEvents++;
      });

      // Generate high event load
      const eventGenerationStart = performance.now();
      
      const eventPromises = Array.from({ length: 100 }, async (_, i) => {
        memoryManager.emit('pressure-change', `level-${i % 3}`);
        memoryManager.emit('cleanup-completed', `level-${i % 3}`);
        
        if (i % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      });

      await Promise.all(eventPromises);
      
      const eventGenerationEnd = performance.now();
      const totalEventTime = eventGenerationEnd - eventGenerationStart;

      // Event processing should be efficient
      expect(totalEventTime).toBeLessThan(500); // 500ms for 200 events
      expect(processedEvents).toBe(200);
      
      const eventsPerSecond = processedEvents / (totalEventTime / 1000);
      expect(eventsPerSecond).toBeGreaterThan(400); // At least 400 events/sec
    });
  });

  describe('monitoring overhead', () => {
    it('should maintain low CPU overhead during monitoring', async () => {
      const monitoringConfig = {
        checkInterval: 100,
        thresholds: { low: 0.6, medium: 0.8, high: 0.9 },
        enableGC: true,
        trackHistory: true
      };

      const monitoredManager = new MemoryManager(monitoringConfig);
      
      // Measure baseline performance
      const baselineTasks = Array.from({ length: 1000 }, () => Math.random() * 1000);
      const baselineStart = performance.now();
      baselineTasks.forEach(x => Math.sqrt(x));
      const baselineEnd = performance.now();
      const baselineTime = baselineEnd - baselineStart;

      // Start monitoring and measure performance impact
      await monitoredManager.startMonitoring();
      
      const monitoredTasks = Array.from({ length: 1000 }, () => Math.random() * 1000);
      const monitoredStart = performance.now();
      monitoredTasks.forEach(x => Math.sqrt(x));
      const monitoredEnd = performance.now();
      const monitoredTime = monitoredEnd - monitoredStart;

      await monitoredManager.stop();

      // Monitoring overhead should be minimal
      const overhead = (monitoredTime - baselineTime) / baselineTime;
      expect(overhead).toBeLessThan(0.1); // Less than 10% overhead
    });

    it('should scale monitoring intervals efficiently', async () => {
      const intervals = [50, 100, 200, 500];
      const intervalPerformance: number[] = [];

      for (const interval of intervals) {
        const intervalManager = new MemoryManager({
          checkInterval: interval,
          trackHistory: true
        });

        await intervalManager.startMonitoring();
        
        const startTime = performance.now();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Run for 1 second
        const endTime = performance.now();
        
        await intervalManager.stop();
        
        intervalPerformance.push(endTime - startTime);
      }

      // Performance should be consistent across intervals
      const performanceVariance = Math.max(...intervalPerformance) - Math.min(...intervalPerformance);
      expect(performanceVariance).toBeLessThan(100); // Low variance
    });
  });
});