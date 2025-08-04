/**
 * Test helper utilities for timeout handling and resource management
 */

export interface TimeoutResource {
  operationName: string;
  timeoutMs: number;
  startTime: number;
}

export interface CleanupManager {
  addTimeoutResource(resource: TimeoutResource): void;
  forceCleanup(operationName: string): Promise<void>;
}

/**
 * Wraps a promise with a timeout using Promise.race
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout duration in milliseconds
 * @param operationName - Name of the operation for error messages
 * @param cleanupManager - Optional cleanup manager for resource tracking
 * @returns Promise that resolves/rejects based on race between promise and timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName?: string,
  cleanupManager?: CleanupManager
): Promise<T> {
  const opName = operationName && operationName.trim() ? operationName : 'Operation';
  let timeoutId: NodeJS.Timeout;
  
  // Track timeout resource if cleanup manager provided
  if (cleanupManager) {
    try {
      cleanupManager.addTimeoutResource({
        operationName: opName,
        timeoutMs,
        startTime: Date.now()
      });
    } catch (error) {
      // Silently handle cleanup manager errors
    }
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(async () => {
      // Call force cleanup if available
      if (cleanupManager) {
        try {
          await cleanupManager.forceCleanup(opName);
        } catch (error) {
          // Silently handle cleanup errors
        }
      }
      reject(new Error(`${opName} timed out after ${timeoutMs}ms`));
    }, Math.max(0, timeoutMs));
  });

  return Promise.race([
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        return value;
      },
      (error) => {
        clearTimeout(timeoutId);
        throw error;
      }
    ),
    timeoutPromise
  ]);
}