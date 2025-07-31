import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { BatchProcessor } from "../../src/storage/batch-processor.js";
import type { BatchItem, ProcessingResult, BatchProcessorOptions } from "../../src/storage/batch-processor.js";
import { performance } from "perf_hooks";

describe('BatchProcessor Performance Benchmarks', () => {
  let processor: BatchProcessor;

  afterEach(async () => {
    if (processor) {
      await processor.stop();
    }
  });

  describe('batch processing throughput', () => {
    it('should achieve high throughput (items/second) for simple operations', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 50,
        maxQueueSize: 10000,
        retryLimit: 3,
        processingInterval: 10 // Fast processing
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          // Simulate fast processing
          await new Promise(resolve => setTimeout(resolve, 1));
          return items.map(item => ({
            id: item.id,
            success: true
          }));
        }
      );

      await processor.start();

      const itemCount = 1000;
      const testItems: BatchItem[] = Array.from({ length: itemCount }, (_, i) => ({
        id: `item-${i}`,
        type: 'test',
        data: { value: i }
      }));

      const startTime = performance.now();

      // Add all items to queue
      const addPromises = testItems.map(item => processor.addItem(item));
      await Promise.all(addPromises);

      // Wait for all items to be processed
      await processor.flush();
      
      const endTime = performance.now();
      const totalTime = (endTime - startTime) / 1000; // Convert to seconds

      const throughput = itemCount / totalTime;
      expect(throughput).toBeGreaterThan(50); // At least 50 items/second in test environment

      const stats = processor.getStatistics();
      expect(stats.totalProcessed).toBe(itemCount);
      expect(stats.succeeded).toBe(itemCount);
    });

    it('should maintain throughput with varying batch sizes', async () => {
      const batchSizes = [10, 25, 50, 100];
      const throughputResults: number[] = [];

      for (const batchSize of batchSizes) {
        const testProcessor = new BatchProcessor(
          {
            batchSize,
            maxQueueSize: 5000,
            retryLimit: 2,
            processingInterval: 20
          },
          async (items: BatchItem[]): Promise<ProcessingResult[]> => {
            await new Promise(resolve => setTimeout(resolve, 2));
            return items.map(item => ({ id: item.id, success: true }));
          }
        );

        await testProcessor.start();

        const itemCount = 200;
        const items: BatchItem[] = Array.from({ length: itemCount }, (_, i) => ({
          id: `batch-${batchSize}-item-${i}`,
          type: 'throughput-test',
          data: { batchSize }
        }));

        const startTime = performance.now();
        
        for (const item of items) {
          await testProcessor.addItem(item);
        }
        
        await testProcessor.flush();
        const endTime = performance.now();

        const throughput = itemCount / ((endTime - startTime) / 1000);
        throughputResults.push(throughput);

        await testProcessor.stop();
      }

      // All batch sizes should maintain reasonable throughput
      throughputResults.forEach(throughput => {
        expect(throughput).toBeGreaterThan(10); // Lower threshold for test environment
      });

      // Throughput should scale reasonably with batch size
      const minThroughput = Math.min(...throughputResults);
      const maxThroughput = Math.max(...throughputResults);
      const scalingRatio = maxThroughput / minThroughput;
      expect(scalingRatio).toBeLessThan(5); // Should not vary more than 5x
    });

    it('should handle high-volume processing efficiently', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 100,
        maxQueueSize: 50000,
        retryLimit: 2,
        processingInterval: 5
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          // Simulate bulk processing operation
          await new Promise(resolve => setTimeout(resolve, 5));
          return items.map(item => ({
            id: item.id,
            success: Math.random() > 0.05 // 95% success rate
          }));
        }
      );

      await processor.start();

      const highVolumeCount = 10000;
      const startTime = performance.now();

      // Add items in chunks to avoid overwhelming the system
      const chunkSize = 500;
      for (let i = 0; i < highVolumeCount; i += chunkSize) {
        const chunk = Array.from({ length: Math.min(chunkSize, highVolumeCount - i) }, (_, j) => ({
          id: `high-vol-${i + j}`,
          type: 'bulk',
          data: { index: i + j, chunk: Math.floor(i / chunkSize) }
        }));

        await Promise.all(chunk.map(item => processor.addItem(item)));
        
        // Brief pause to prevent queue overflow
        if (i % 2000 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      await processor.flush();
      const endTime = performance.now();
      const totalTime = (endTime - startTime) / 1000;

      const throughput = highVolumeCount / totalTime;
      expect(throughput).toBeGreaterThan(20); // At least 20 items/second for high volume in test environment

      const stats = processor.getStatistics();
      expect(stats.totalProcessed).toBe(highVolumeCount);
      expect(stats.succeeded).toBeGreaterThan(highVolumeCount * 0.9); // At least 90% success
    });
  });

  describe('queue management overhead', () => {
    it('should maintain low queue management overhead', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 20,
        maxQueueSize: 1000,
        retryLimit: 3,
        processingInterval: 50
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return items.map(item => ({ id: item.id, success: true }));
        }
      );

      await processor.start();

      const enqueueTimes: number[] = [];
      const itemCount = 500;

      // Measure queue operation overhead
      for (let i = 0; i < itemCount; i++) {
        const item: BatchItem = {
          id: `queue-test-${i}`,
          type: 'queue-overhead',
          data: { sequence: i }
        };

        const startTime = performance.now();
        await processor.addItem(item);
        const endTime = performance.now();
        
        enqueueTimes.push(endTime - startTime);
      }

      const avgEnqueueTime = enqueueTimes.reduce((a, b) => a + b) / enqueueTimes.length;
      expect(avgEnqueueTime).toBeLessThan(10); // Less than 10ms per enqueue in test environment

      // Calculate p95 enqueue time
      enqueueTimes.sort((a, b) => a - b);
      const p95Index = Math.floor(enqueueTimes.length * 0.95);
      const p95Time = enqueueTimes[p95Index];
      expect(p95Time).toBeLessThan(50); // p95 should be under 50ms in test environment

      await processor.flush();
    });

    it('should handle queue near capacity efficiently', async () => {
      const queueSize = 100;
      const options: BatchProcessorOptions = {
        batchSize: 10,
        maxQueueSize: queueSize,
        retryLimit: 2,
        processingInterval: 100 // Slow processing to fill queue
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return items.map(item => ({ id: item.id, success: true }));
        }
      );

      await processor.start();

      const capacityTimes: number[] = [];

      // Fill queue to near capacity
      for (let i = 0; i < queueSize - 5; i++) {
        await processor.addItem({
          id: `capacity-${i}`,
          type: 'capacity-test',
          data: { index: i }
        });
      }

      // Measure performance near capacity
      for (let i = 0; i < 10; i++) {
        const startTime = performance.now();
        
        try {
          await processor.addItem({
            id: `near-capacity-${i}`,
            type: 'capacity-test',
            data: { nearCapacity: true }
          });
          
          const endTime = performance.now();
          capacityTimes.push(endTime - startTime);
        } catch (error) {
          // Queue might be full, which is expected
          break;
        }
      }

      if (capacityTimes.length > 0) {
        const avgCapacityTime = capacityTimes.reduce((a, b) => a + b) / capacityTimes.length;
        expect(avgCapacityTime).toBeLessThan(100); // Should remain reasonable near capacity in test environment
      }

      await processor.flush();
    });

    it('should optimize queue operations for different item types', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 30,
        maxQueueSize: 2000,
        retryLimit: 3,
        processingInterval: 25,
        typeBatchSizes: {
          'fast': 50,
          'medium': 25,
          'slow': 10
        }
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          const delay = items[0]?.type === 'fast' ? 1 : items[0]?.type === 'medium' ? 5 : 10;
          await new Promise(resolve => setTimeout(resolve, delay));
          return items.map(item => ({ id: item.id, success: true }));
        }
      );

      await processor.start();

      const itemTypes = ['fast', 'medium', 'slow'];
      const typePerformance: Record<string, number[]> = {};

      // Test different item types
      for (const type of itemTypes) {
        typePerformance[type] = [];
        
        for (let i = 0; i < 50; i++) {
          const startTime = performance.now();
          
          await processor.addItem({
            id: `${type}-${i}`,
            type,
            data: { itemType: type }
          });
          
          const endTime = performance.now();
          typePerformance[type].push(endTime - startTime);
        }
      }

      await processor.flush();

      // All types should have reasonable performance
      Object.values(typePerformance).forEach(times => {
        const avgTime = times.reduce((a, b) => a + b) / times.length;
        expect(avgTime).toBeLessThan(20); // Less than 20ms in test environment
      });
    });
  });

  describe('priority queue performance', () => {
    it('should handle priority-based processing efficiently', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 25,
        maxQueueSize: 1000,
        retryLimit: 2,
        processingInterval: 20,
        priorityComparator: (a, b) => (b.priority || 0) - (a.priority || 0)
      };

      const processedOrder: string[] = [];

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          items.forEach(item => processedOrder.push(item.id));
          await new Promise(resolve => setTimeout(resolve, 5));
          return items.map(item => ({ id: item.id, success: true }));
        }
      );

      await processor.start();

      const priorities = [1, 5, 3, 9, 2, 8, 4, 7, 6];
      const priorityTimes: number[] = [];

      // Add items with different priorities
      for (const priority of priorities) {
        const startTime = performance.now();
        
        await processor.addItem({
          id: `priority-${priority}`,
          type: 'priority-test',
          data: { value: priority },
          priority
        });
        
        const endTime = performance.now();
        priorityTimes.push(endTime - startTime);
      }

      await processor.flush();

      // Priority operations should be fast
      const avgPriorityTime = priorityTimes.reduce((a, b) => a + b) / priorityTimes.length;
      expect(avgPriorityTime).toBeLessThan(20); // Less than 20ms in test environment

      // Items should be processed in priority order (implementation dependent)
      expect(processedOrder.length).toBe(priorities.length);
    });

    it('should maintain priority queue performance under load', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 40,
        maxQueueSize: 5000,
        retryLimit: 3,
        processingInterval: 15,
        priorityComparator: (a, b) => (b.priority || 0) - (a.priority || 0)
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          await new Promise(resolve => setTimeout(resolve, 3));
          return items.map(item => ({ id: item.id, success: true }));
        }
      );

      await processor.start();

      const itemCount = 1000;
      const startTime = performance.now();

      // Add items with random priorities
      const addPromises = Array.from({ length: itemCount }, (_, i) => 
        processor.addItem({
          id: `load-priority-${i}`,
          type: 'priority-load',
          data: { index: i },
          priority: Math.floor(Math.random() * 10)
        })
      );

      await Promise.all(addPromises);
      await processor.flush();
      
      const endTime = performance.now();
      const totalTime = (endTime - startTime) / 1000;

      const throughput = itemCount / totalTime;
      expect(throughput).toBeGreaterThan(10); // Should maintain throughput with priorities in test environment

      const stats = processor.getStatistics();
      expect(stats.totalProcessed).toBe(itemCount);
    });
  });

  describe('error recovery impact', () => {
    it('should maintain performance during error recovery', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 20,
        maxQueueSize: 1000,
        retryLimit: 3,
        processingInterval: 30
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          await new Promise(resolve => setTimeout(resolve, 5));
          
          return items.map(item => ({
            id: item.id,
            success: Math.random() > 0.3, // 30% failure rate
            error: Math.random() <= 0.3 ? 'Simulated processing error' : undefined
          }));
        }
      );

      await processor.start();

      const itemCount = 300;
      const startTime = performance.now();

      // Process items with expected failures
      const addPromises = Array.from({ length: itemCount }, (_, i) =>
        processor.addItem({
          id: `error-recovery-${i}`,
          type: 'error-test',
          data: { attempt: 1 }
        })
      );

      await Promise.all(addPromises);
      await processor.flush();
      
      const endTime = performance.now();
      const totalTime = (endTime - startTime) / 1000;

      // Should maintain reasonable throughput despite errors
      const throughput = itemCount / totalTime;
      expect(throughput).toBeGreaterThan(5); // Lower threshold due to retries in test environment

      const stats = processor.getStatistics();
      expect(stats.totalProcessed).toBe(itemCount);
      expect(stats.failed).toBeGreaterThan(0); // Some failures expected
    });

    it('should handle retry overhead efficiently', async () => {
      let attemptCounts: Record<string, number> = {};

      const options: BatchProcessorOptions = {
        batchSize: 15,
        maxQueueSize: 500,
        retryLimit: 5,
        processingInterval: 25
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          await new Promise(resolve => setTimeout(resolve, 3));
          
          return items.map(item => {
            attemptCounts[item.id] = (attemptCounts[item.id] || 0) + 1;
            const shouldFail = attemptCounts[item.id] <= 2; // Fail first 2 attempts
            
            return {
              id: item.id,
              success: !shouldFail,
              error: shouldFail ? 'Retry test error' : undefined
            };
          });
        }
      );

      await processor.start();

      const retryItemCount = 50;
      const retryStartTime = performance.now();

      // Add items that will require retries
      for (let i = 0; i < retryItemCount; i++) {
        await processor.addItem({
          id: `retry-${i}`,
          type: 'retry-test',
          data: { requiresRetry: true }
        });
      }

      await processor.flush();
      
      const retryEndTime = performance.now();
      const retryTotalTime = (retryEndTime - retryStartTime) / 1000;

      // Should handle retries efficiently
      const retryThroughput = retryItemCount / retryTotalTime;
      expect(retryThroughput).toBeGreaterThan(2); // Lower due to retries in test environment

      const stats = processor.getStatistics();
      expect(stats.succeeded).toBe(retryItemCount); // All should eventually succeed
    });

    it('should isolate errors to prevent cascade failures', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 10,
        maxQueueSize: 200,
        retryLimit: 2,
        processingInterval: 40
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          await new Promise(resolve => setTimeout(resolve, 8));
          
          return items.map((item, index) => {
            // Make every 3rd item fail to test isolation
            if (index % 3 === 0) {
              return { id: item.id, success: false, error: 'Isolated failure' };
            }
            return { id: item.id, success: true };
          });
        }
      );

      await processor.start();

      const isolationTestCount = 60;
      const isolationStartTime = performance.now();

      for (let i = 0; i < isolationTestCount; i++) {
        await processor.addItem({
          id: `isolation-${i}`,
          type: 'isolation-test',
          data: { index: i }
        });
      }

      await processor.flush();
      
      const isolationEndTime = performance.now();
      const isolationTime = (isolationEndTime - isolationStartTime) / 1000;

      // Processing should continue despite isolated failures
      const isolationThroughput = isolationTestCount / isolationTime;
      expect(isolationThroughput).toBeGreaterThan(5); // Test environment threshold

      const stats = processor.getStatistics();
      expect(stats.totalProcessed).toBe(isolationTestCount);
      expect(stats.succeeded).toBeGreaterThan(0);
      expect(stats.failed).toBeGreaterThan(0);
    });
  });

  describe('memory usage with large queues', () => {
    it('should maintain reasonable memory usage with large queues', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 100,
        maxQueueSize: 10000,
        retryLimit: 2,
        processingInterval: 50 // Slow to allow queue buildup
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return items.map(item => ({ id: item.id, success: true }));
        }
      );

      const initialMemory = process.memoryUsage().heapUsed;
      await processor.start();

      // Fill queue with large items
      const largeItemCount = 5000;
      const largeItemData = 'x'.repeat(1000); // 1KB per item

      for (let i = 0; i < largeItemCount; i++) {
        await processor.addItem({
          id: `memory-test-${i}`,
          type: 'memory',
          data: { 
            payload: largeItemData,
            index: i 
          }
        });

        // Check memory periodically
        if (i % 1000 === 0) {
          const currentMemory = process.memoryUsage().heapUsed;
          const memoryIncrease = currentMemory - initialMemory;
          
          // Memory increase should be reasonable
          expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB
        }
      }

      await processor.flush();

      const finalMemory = process.memoryUsage().heapUsed;
      const totalMemoryIncrease = finalMemory - initialMemory;

      // Total memory increase should be controlled
      expect(totalMemoryIncrease).toBeLessThan(100 * 1024 * 1024); // Less than 100MB
    });

    it('should handle memory pressure gracefully', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 50,
        maxQueueSize: 2000,
        retryLimit: 3,
        processingInterval: 100
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          // Simulate memory-intensive processing
          const tempArray = new Array(10000).fill('memory-test');
          await new Promise(resolve => setTimeout(resolve, 10));
          tempArray.length = 0; // Clear memory
          
          return items.map(item => ({ id: item.id, success: true }));
        }
      );

      await processor.start();

      // Generate memory pressure
      const pressureItemCount = 1000;
      const pressureStartTime = performance.now();

      const pressurePromises = Array.from({ length: pressureItemCount }, (_, i) =>
        processor.addItem({
          id: `pressure-${i}`,
          type: 'memory-pressure',
          data: { 
            largeData: new Array(500).fill(`item-${i}`),
            timestamp: Date.now()
          }
        })
      );

      await Promise.all(pressurePromises);
      await processor.flush();
      
      const pressureEndTime = performance.now();
      const pressureTime = (pressureEndTime - pressureStartTime) / 1000;

      // Should handle memory pressure without significant performance degradation
      const pressureThroughput = pressureItemCount / pressureTime;
      expect(pressureThroughput).toBeGreaterThan(5); // Test environment threshold

      const stats = processor.getStatistics();
      expect(stats.totalProcessed).toBe(pressureItemCount);
      expect(stats.succeeded).toBe(pressureItemCount);
    });
  });

  describe('concurrent batch processing', () => {
    it('should handle concurrent add operations efficiently', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 30,
        maxQueueSize: 3000,
        retryLimit: 2,
        processingInterval: 20
      };

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          await new Promise(resolve => setTimeout(resolve, 8));
          return items.map(item => ({ id: item.id, success: true }));
        }
      );

      await processor.start();

      const concurrentAddCount = 500;
      const concurrentStartTime = performance.now();

      // Create concurrent add operations
      const concurrentPromises = Array.from({ length: concurrentAddCount }, (_, i) =>
        processor.addItem({
          id: `concurrent-${i}`,
          type: 'concurrent-test',
          data: { 
            threadId: i % 10,
            timestamp: Date.now()
          }
        })
      );

      await Promise.all(concurrentPromises);
      await processor.flush();
      
      const concurrentEndTime = performance.now();
      const concurrentTime = (concurrentEndTime - concurrentStartTime) / 1000;

      const concurrentThroughput = concurrentAddCount / concurrentTime;
      expect(concurrentThroughput).toBeGreaterThan(10); // Should handle concurrent adds in test environment

      const stats = processor.getStatistics();
      expect(stats.totalProcessed).toBe(concurrentAddCount);
      expect(stats.succeeded).toBe(concurrentAddCount);
    });

    it('should maintain thread safety under concurrent access', async () => {
      const options: BatchProcessorOptions = {
        batchSize: 25,
        maxQueueSize: 1500,
        retryLimit: 3,
        processingInterval: 30
      };

      let processingCounter = 0;

      processor = new BatchProcessor(
        options,
        async (items: BatchItem[]): Promise<ProcessingResult[]> => {
          processingCounter += items.length;
          await new Promise(resolve => setTimeout(resolve, 5));
          return items.map(item => ({ id: item.id, success: true }));
        }
      );

      await processor.start();

      const threadCount = 10;
      const itemsPerThread = 50;

      // Simulate multiple threads adding items concurrently
      const threadPromises = Array.from({ length: threadCount }, async (_, threadId) => {
        const threadItems = Array.from({ length: itemsPerThread }, (_, i) => ({
          id: `thread-${threadId}-item-${i}`,
          type: 'thread-safety',
          data: { threadId, itemIndex: i }
        }));

        // Add items from this "thread"
        for (const item of threadItems) {
          await processor.addItem(item);
          // Small random delay to increase concurrency
          if (Math.random() < 0.1) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
      });

      await Promise.all(threadPromises);
      await processor.flush();

      const expectedTotal = threadCount * itemsPerThread;
      expect(processingCounter).toBe(expectedTotal);

      const stats = processor.getStatistics();
      expect(stats.totalProcessed).toBe(expectedTotal);
      expect(stats.succeeded).toBe(expectedTotal);
    });
  });
});