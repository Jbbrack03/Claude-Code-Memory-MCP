import { EventEmitter } from "events";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("BatchProcessor");

export interface BatchItem {
  id: string;
  type: string;
  data: Record<string, unknown>;
  priority?: number;
  retryCount?: number;
}

export interface ProcessingResult {
  id: string;
  success: boolean;
  error?: string;
}

export interface BatchProcessorOptions {
  batchSize: number;
  maxQueueSize: number;
  retryLimit: number;
  processingInterval: number;
  flushOnStop?: boolean;
  priorityComparator?: (a: BatchItem, b: BatchItem) => number;
  typeBatchSizes?: Record<string, number>;
}

export interface BatchStatistics {
  totalProcessed: number;
  succeeded: number;
  failed: number;
  queueSize: number;
  isRunning: boolean;
  isProcessing: boolean;
}

export class BatchProcessor extends EventEmitter {
  private queue: BatchItem[] = [];
  private processing = false;
  private running = false;
  private intervalId: NodeJS.Timeout | null = null;
  private stats = {
    totalProcessed: 0,
    succeeded: 0,
    failed: 0
  };

  constructor(
    private processor: (items: BatchItem[]) => Promise<ProcessingResult[]>,
    private options: BatchProcessorOptions
  ) {
    super();
  }

  add(item: BatchItem): boolean {
    if (this.queue.length >= this.options.maxQueueSize) {
      return false;
    }
    
    // Initialize retry count if not set
    if (item.retryCount === undefined) {
      item.retryCount = 0;
    }
    
    this.queue.push(item);
    return true;
  }

  addBatch(items: BatchItem[]): boolean[] {
    const results: boolean[] = [];
    for (const item of items) {
      results.push(this.add(item));
    }
    return results;
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getQueuedItems(): BatchItem[] {
    return [...this.queue];
  }

  start(): void {
    if (this.running) {
      return;
    }
    
    this.running = true;
    this.intervalId = setInterval(() => {
      if (!this.processing) {
        this.processBatch().catch(err => {
          logger.error("Error in batch processing", err);
        });
      }
    }, this.options.processingInterval);
  }

  async stop(): Promise<void> {
    this.running = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    // Wait for current processing to complete
    // Use a simple polling approach that works with fake timers
    while (this.processing) {
      // Give control back to event loop
      await Promise.resolve();
    }
    
    // Flush remaining items if configured
    if (this.options.flushOnStop && this.queue.length > 0) {
      await this.processBatch();
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  getStatistics(): BatchStatistics {
    return {
      totalProcessed: this.stats.totalProcessed,
      succeeded: this.stats.succeeded,
      failed: this.stats.failed,
      queueSize: this.queue.length,
      isRunning: this.running,
      isProcessing: this.processing
    };
  }

  resetStatistics(): void {
    this.stats = {
      totalProcessed: 0,
      succeeded: 0,
      failed: 0
    };
  }

  private async processBatch(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    try {
      // Determine batch size based on item types
      const batchSize = this.determineBatchSize();
      
      // Sort queue if priority comparator provided
      if (this.options.priorityComparator) {
        this.queue.sort(this.options.priorityComparator);
      }
      
      // Get items for this batch
      const batch = this.queue.splice(0, batchSize);
      
      this.emit('batchStart', { batchSize: batch.length });
      
      let results: ProcessingResult[];
      try {
        results = await this.processor(batch);
      } catch (error) {
        // Processor threw an exception
        this.emit('processorError', { error, batch });
        
        // Re-queue all items
        this.queue.unshift(...batch);
        return;
      }
      
      // Process results
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const result = results[i];
        
        if (!item || !result) {
          continue;
        }
        
        if (result.success) {
          this.stats.succeeded++;
          this.stats.totalProcessed++;
          this.emit('itemProcessed', { item, result });
        } else {
          // Count as processed and failed
          this.stats.totalProcessed++;
          this.stats.failed++;
          
          // Check retry limit
          item.retryCount = (item.retryCount || 0) + 1;
          
          if (item.retryCount <= this.options.retryLimit) {
            // Re-queue for retry at the end of the queue
            this.queue.push(item);
          } else {
            // Exceeded retry limit
            this.emit('itemFailed', { 
              item, 
              error: result.error, 
              attempts: item.retryCount 
            });
          }
        }
      }
      
      this.emit('batchComplete', { 
        processed: batch.length,
        succeeded: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      });
      
    } finally {
      this.processing = false;
    }
  }

  private determineBatchSize(): number {
    if (!this.options.typeBatchSizes || this.queue.length === 0) {
      return Math.min(this.options.batchSize, this.queue.length);
    }
    
    // Get the type of the first item in queue
    const firstItem = this.queue[0];
    if (!firstItem) {
      return this.options.batchSize;
    }
    const firstType = firstItem.type;
    
    // Count consecutive items of the same type
    let count = 0;
    for (const item of this.queue) {
      if (item.type === firstType) {
        count++;
      } else {
        break;
      }
    }
    
    // Use type-specific batch size if available
    const typeBatchSize = this.options.typeBatchSizes[firstType] || this.options.batchSize;
    return Math.min(typeBatchSize, count);
  }
}