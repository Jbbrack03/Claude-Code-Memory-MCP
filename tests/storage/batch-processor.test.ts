import { BatchProcessor, BatchItem, BatchProcessorOptions, ProcessingResult } from '../../src/storage/batch-processor.js';
import { jest } from '@jest/globals';

describe('BatchProcessor', () => {
  // Mock processor function
  const mockProcessor = jest.fn<(items: BatchItem[]) => Promise<ProcessingResult[]>>();
  
  // Default options
  const defaultOptions: BatchProcessorOptions = {
    batchSize: 10,
    maxQueueSize: 100,
    retryLimit: 3,
    processingInterval: 100
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Queue Management', () => {
    it('should add items to the queue', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, defaultOptions);
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: { content: 'test1' } },
        { id: '2', type: 'memory', data: { content: 'test2' } }
      ];

      // When
      const result1 = await processor.add(items[0]);
      const result2 = await processor.add(items[1]);

      // Then
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(processor.getQueueSize()).toBe(2);
    });

    it('should reject items when queue is full', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, { ...defaultOptions, maxQueueSize: 2 });
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: {} },
        { id: '2', type: 'memory', data: {} },
        { id: '3', type: 'memory', data: {} }
      ];

      // When
      await processor.add(items[0]);
      await processor.add(items[1]);
      const result = await processor.add(items[2]);

      // Then
      expect(result).toBe(false);
      expect(processor.getQueueSize()).toBe(2);
    });

    it('should support batch adding of items', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, defaultOptions);
      const items: BatchItem[] = [
        { id: '1', type: 'embedding', data: { text: 'test1' } },
        { id: '2', type: 'embedding', data: { text: 'test2' } },
        { id: '3', type: 'embedding', data: { text: 'test3' } }
      ];

      // When
      const results = await processor.addBatch(items);

      // Then
      expect(results).toEqual([true, true, true]);
      expect(processor.getQueueSize()).toBe(3);
    });

    it('should handle different batch item types', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, defaultOptions);
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: { content: 'memory data' } },
        { id: '2', type: 'embedding', data: { text: 'text to embed' } },
        { id: '3', type: 'index', data: { documentId: 'doc1' } }
      ];

      // When
      await processor.addBatch(items);

      // Then
      expect(processor.getQueueSize()).toBe(3);
      const queuedItems = processor.getQueuedItems();
      expect(queuedItems.map(item => item.type)).toEqual(['memory', 'embedding', 'index']);
    });
  });

  describe('Batch Processing', () => {
    it('should process items in configured batch sizes', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, { ...defaultOptions, batchSize: 3 });
      const items: BatchItem[] = Array.from({ length: 7 }, (_, i) => ({
        id: `${i + 1}`,
        type: 'memory',
        data: { content: `test${i + 1}` }
      }));
      
      mockProcessor.mockResolvedValueOnce(
        items.slice(0, 3).map(item => ({ id: item.id, success: true }))
      );
      mockProcessor.mockResolvedValueOnce(
        items.slice(3, 6).map(item => ({ id: item.id, success: true }))
      );
      mockProcessor.mockResolvedValueOnce(
        items.slice(6, 7).map(item => ({ id: item.id, success: true }))
      );

      // When
      await processor.addBatch(items);
      await processor.start();
      
      // Process first batch
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      // Process second batch
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      // Process third batch
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      // Then
      expect(mockProcessor).toHaveBeenCalledTimes(3);
      expect(mockProcessor.mock.calls[0][0]).toHaveLength(3);
      expect(mockProcessor.mock.calls[1][0]).toHaveLength(3);
      expect(mockProcessor.mock.calls[2][0]).toHaveLength(1);
    });

    it('should prevent concurrent batch processing', async () => {
      // Given
      const slowProcessor = jest.fn().mockImplementation(async (items: BatchItem[]) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return items.map(item => ({ id: item.id, success: true }));
      });
      
      const processor = new BatchProcessor(slowProcessor, { ...defaultOptions, processingInterval: 50 });
      const items: BatchItem[] = Array.from({ length: 5 }, (_, i) => ({
        id: `${i + 1}`,
        type: 'memory',
        data: {}
      }));

      // When
      await processor.addBatch(items);
      await processor.start();
      
      // Trigger first processing
      jest.advanceTimersByTime(50);
      
      // Try to trigger second processing while first is still running
      jest.advanceTimersByTime(50);
      
      // Then
      expect(slowProcessor).toHaveBeenCalledTimes(1);
      expect(processor.isProcessing()).toBe(true);
    });

    it('should emit processing events', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, defaultOptions);
      const batchStartHandler = jest.fn();
      const batchCompleteHandler = jest.fn();
      const itemProcessedHandler = jest.fn();
      
      processor.on('batchStart', batchStartHandler);
      processor.on('batchComplete', batchCompleteHandler);
      processor.on('itemProcessed', itemProcessedHandler);
      
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: {} },
        { id: '2', type: 'memory', data: {} }
      ];
      
      mockProcessor.mockResolvedValueOnce(
        items.map(item => ({ id: item.id, success: true }))
      );

      // When
      await processor.addBatch(items);
      await processor.start();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      // Then
      expect(batchStartHandler).toHaveBeenCalledWith({ batchSize: 2 });
      expect(batchCompleteHandler).toHaveBeenCalledWith({
        processed: 2,
        succeeded: 2,
        failed: 0
      });
      expect(itemProcessedHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should re-queue failed items up to retry limit', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, { ...defaultOptions, retryLimit: 2 });
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: {} },
        { id: '2', type: 'memory', data: {} }
      ];
      
      // First attempt - item 2 fails
      mockProcessor.mockResolvedValueOnce([
        { id: '1', success: true },
        { id: '2', success: false, error: 'Processing failed' }
      ]);
      
      // Second attempt - item 2 fails again
      mockProcessor.mockResolvedValueOnce([
        { id: '2', success: false, error: 'Processing failed' }
      ]);
      
      // Third attempt - item 2 succeeds
      mockProcessor.mockResolvedValueOnce([
        { id: '2', success: true }
      ]);

      // When
      await processor.addBatch(items);
      await processor.start();
      
      // Process first batch
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      // Process retry
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      // Process final retry
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      // Then
      expect(mockProcessor).toHaveBeenCalledTimes(3);
      expect(processor.getQueueSize()).toBe(0);
    });

    it('should emit error event when item exceeds retry limit', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, { ...defaultOptions, retryLimit: 1 });
      const errorHandler = jest.fn();
      processor.on('itemFailed', errorHandler);
      
      const item: BatchItem = { id: '1', type: 'memory', data: {} };
      
      // Both attempts fail
      mockProcessor.mockResolvedValue([
        { id: '1', success: false, error: 'Persistent error' }
      ]);

      // When
      await processor.add(item);
      await processor.start();
      
      // First attempt
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      // Retry attempt
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      // Then
      expect(mockProcessor).toHaveBeenCalledTimes(2);
      expect(errorHandler).toHaveBeenCalledWith({
        item,
        error: 'Persistent error',
        attempts: 2
      });
    });

    it('should handle processor exceptions gracefully', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, defaultOptions);
      const errorHandler = jest.fn();
      processor.on('processorError', errorHandler);
      
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: {} }
      ];
      
      const error = new Error('Processor crashed');
      mockProcessor.mockRejectedValueOnce(error);

      // When
      await processor.addBatch(items);
      await processor.start();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      // Then
      expect(errorHandler).toHaveBeenCalledWith({ error, batch: items });
      // Items should be re-queued
      expect(processor.getQueueSize()).toBe(1);
    });

    it('should maintain item order during retries', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, { ...defaultOptions, batchSize: 3 });
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: { order: 1 } },
        { id: '2', type: 'memory', data: { order: 2 } },
        { id: '3', type: 'memory', data: { order: 3 } },
        { id: '4', type: 'memory', data: { order: 4 } }
      ];
      
      // First batch - item 2 fails
      mockProcessor.mockResolvedValueOnce([
        { id: '1', success: true },
        { id: '2', success: false },
        { id: '3', success: true }
      ]);
      
      // Second batch - all succeed
      mockProcessor.mockResolvedValueOnce([
        { id: '4', success: true },
        { id: '2', success: true }
      ]);

      // When
      await processor.addBatch(items);
      await processor.start();
      
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      // Then
      expect(mockProcessor).toHaveBeenCalledTimes(2);
      // Second call should have item 4 first (maintaining FIFO order)
      expect(mockProcessor.mock.calls[1][0][0].id).toBe('4');
      expect(mockProcessor.mock.calls[1][0][1].id).toBe('2');
    });
  });

  describe('Lifecycle Management', () => {
    it('should start and stop processing', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, defaultOptions);
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: {} }
      ];
      
      mockProcessor.mockResolvedValue([
        { id: '1', success: true }
      ]);

      // When
      await processor.addBatch(items);
      await processor.start();
      expect(processor.isRunning()).toBe(true);
      
      await processor.stop();
      expect(processor.isRunning()).toBe(false);
      
      // Advance timers - should not process
      jest.advanceTimersByTime(100);
      
      // Then
      expect(mockProcessor).not.toHaveBeenCalled();
    });

    it('should flush remaining items on stop', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, { ...defaultOptions, flushOnStop: true });
      const items: BatchItem[] = Array.from({ length: 5 }, (_, i) => ({
        id: `${i + 1}`,
        type: 'memory',
        data: {}
      }));
      
      mockProcessor.mockResolvedValue(
        items.map(item => ({ id: item.id, success: true }))
      );

      // When
      await processor.addBatch(items);
      await processor.start();
      await processor.stop();

      // Then
      expect(mockProcessor).toHaveBeenCalledWith(items);
      expect(processor.getQueueSize()).toBe(0);
    });

    it('should handle graceful shutdown', async () => {
      // Given
      const slowProcessor = jest.fn().mockImplementation(async (items: BatchItem[]) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return items.map(item => ({ id: item.id, success: true }));
      });
      
      const processor = new BatchProcessor(slowProcessor, defaultOptions);
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: {} }
      ];

      // When
      await processor.addBatch(items);
      await processor.start();
      
      // Start processing
      jest.advanceTimersByTime(100);
      
      // Try to stop while processing
      const stopPromise = processor.stop();
      
      // Complete processing
      jest.runAllTimers();
      await stopPromise;

      // Then
      expect(processor.isProcessing()).toBe(false);
      expect(processor.isRunning()).toBe(false);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track processing statistics', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, defaultOptions);
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: {} },
        { id: '2', type: 'memory', data: {} },
        { id: '3', type: 'memory', data: {} }
      ];
      
      mockProcessor.mockResolvedValueOnce([
        { id: '1', success: true },
        { id: '2', success: false },
        { id: '3', success: true }
      ]);

      // When
      await processor.addBatch(items);
      await processor.start();
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      const stats = processor.getStatistics();

      // Then
      expect(stats).toEqual({
        totalProcessed: 3,
        succeeded: 2,
        failed: 1,
        queueSize: 1, // Failed item re-queued
        isRunning: true,
        isProcessing: false
      });
    });

    it('should reset statistics', async () => {
      // Given
      const processor = new BatchProcessor(mockProcessor, defaultOptions);
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: {} }
      ];
      
      mockProcessor.mockResolvedValue([
        { id: '1', success: true }
      ]);

      // When
      await processor.add(items[0]);
      await processor.start();
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      processor.resetStatistics();
      const stats = processor.getStatistics();

      // Then
      expect(stats.totalProcessed).toBe(0);
      expect(stats.succeeded).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  describe('Custom Processing Strategies', () => {
    it('should support priority-based processing', async () => {
      // Given
      const priorityProcessor = new BatchProcessor(mockProcessor, {
        ...defaultOptions,
        priorityComparator: (a, b) => (b.priority || 0) - (a.priority || 0)
      });
      
      const items: BatchItem[] = [
        { id: '1', type: 'memory', data: {}, priority: 1 },
        { id: '2', type: 'memory', data: {}, priority: 3 },
        { id: '3', type: 'memory', data: {}, priority: 2 }
      ];
      
      mockProcessor.mockResolvedValue(
        items.map(item => ({ id: item.id, success: true }))
      );

      // When
      await priorityProcessor.addBatch(items);
      await priorityProcessor.start();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      // Then
      const processedItems = mockProcessor.mock.calls[0][0];
      expect(processedItems.map(item => item.id)).toEqual(['2', '3', '1']);
    });

    it('should support type-specific batch sizes', async () => {
      // Given
      const typeProcessor = new BatchProcessor(mockProcessor, {
        ...defaultOptions,
        batchSize: 2,
        typeBatchSizes: {
          'memory': 3,
          'embedding': 5
        }
      });
      
      const memoryItems: BatchItem[] = Array.from({ length: 4 }, (_, i) => ({
        id: `m${i + 1}`,
        type: 'memory',
        data: {}
      }));
      
      const embeddingItems: BatchItem[] = Array.from({ length: 6 }, (_, i) => ({
        id: `e${i + 1}`,
        type: 'embedding',
        data: {}
      }));
      
      mockProcessor.mockResolvedValue([]);

      // When
      await typeProcessor.addBatch([...memoryItems, ...embeddingItems]);
      await typeProcessor.start();
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      // Then
      // Should process memory items in batch of 3
      expect(mockProcessor.mock.calls[0][0].filter(item => item.type === 'memory')).toHaveLength(3);
    });
  });
});