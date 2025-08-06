/**
 * Mock circuit breaker for testing hook resilience patterns
 */

import { EventEmitter } from 'events';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  resetTimeout?: number;
  monitoringPeriod?: number;
  minimumThroughput?: number;
  halfOpenMaxCalls?: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  totalCalls: number;
  rejectedCalls: number;
}

export class MockCircuitBreaker extends EventEmitter {
  private config: Required<CircuitBreakerConfig>;
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: number;
  private totalCalls = 0;
  private rejectedCalls = 0;
  private halfOpenCalls = 0;
  private resetTimer?: NodeJS.Timeout;

  constructor(config: CircuitBreakerConfig = {}) {
    super();
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeout: config.resetTimeout ?? 60000, // 1 minute
      monitoringPeriod: config.monitoringPeriod ?? 10000, // 10 seconds
      minimumThroughput: config.minimumThroughput ?? 10,
      halfOpenMaxCalls: config.halfOpenMaxCalls ?? 3,
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>, operationName?: string): Promise<T> {
    this.totalCalls++;
    const opName = operationName || 'Operation';

    // Check if circuit is open
    if (this.state === 'OPEN') {
      this.rejectedCalls++;
      this.emit('circuitOpen', { operationName: opName, state: this.getStats() });
      throw new Error(`Circuit breaker is OPEN. Operation '${opName}' rejected.`);
    }

    // Check if in half-open state and limit exceeded
    // Also check if recently transitioned from HALF_OPEN but limit is still enforced
    if ((this.state === 'HALF_OPEN' || (this.state === 'CLOSED' && this.halfOpenCalls > 0)) && 
        this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
      this.rejectedCalls++;
      this.emit('halfOpenLimitExceeded', { operationName: opName, calls: this.halfOpenCalls });
      throw new Error('HALF_OPEN limit exceeded');
    }

    try {
      if (this.state === 'HALF_OPEN') {
        this.halfOpenCalls++;
      }

      const result = await operation();
      this.onSuccess(opName);
      return result;
    } catch (error) {
      this.onFailure(error as Error, opName);
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(operationName: string): void {
    this.successCount++;
    
    if (this.state === 'HALF_OPEN') {
      // Transition to CLOSED if we've reached the max calls
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        this.transitionToClosed();
        this.emit('circuitClosed', { operationName, reason: 'halfOpenSuccess' });
      }
    }

    this.emit('operationSuccess', { operationName, state: this.state });
  }

  /**
   * Handle failed operation
   */
  private onFailure(error: Error, operationName: string): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Immediately transition back to OPEN on any failure in half-open
      this.transitionToOpen();
      this.emit('circuitOpen', { operationName, reason: 'halfOpenFailure', error: error.message });
    } else if (this.state === 'CLOSED' && this.shouldOpenCircuit()) {
      // Transition to OPEN if failure threshold exceeded
      this.transitionToOpen();
      this.emit('circuitOpen', { operationName, reason: 'failureThreshold', failureCount: this.failureCount });
    }

    this.emit('operationFailure', { operationName, error: error.message, state: this.state });
  }

  /**
   * Check if circuit should open based on failure threshold
   */
  private shouldOpenCircuit(): boolean {
    return this.failureCount >= this.config.failureThreshold &&
           this.totalCalls >= this.config.minimumThroughput;
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    // Keep halfOpenCalls to track limit enforcement
    this.clearResetTimer();
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(): void {
    this.state = 'OPEN';
    this.halfOpenCalls = 0;
    this.scheduleReset();
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    this.state = 'HALF_OPEN';
    this.halfOpenCalls = 0;
    this.clearResetTimer();
    this.emit('circuitHalfOpen', { timestamp: Date.now() });
  }

  /**
   * Schedule reset timer for transitioning from OPEN to HALF_OPEN
   */
  private scheduleReset(): void {
    this.clearResetTimer();
    this.resetTimer = setTimeout(() => {
      if (this.state === 'OPEN') {
        this.transitionToHalfOpen();
      }
    }, this.config.resetTimeout);
  }

  /**
   * Clear the reset timer
   */
  private clearResetTimer(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }

  /**
   * Force circuit state change (for testing)
   */
  forceState(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    
    if (newState === 'OPEN') {
      this.scheduleReset();
    } else {
      this.clearResetTimer();
    }
    
    if (newState === 'HALF_OPEN') {
      this.halfOpenCalls = 0;
    }

    this.emit('stateForced', { from: oldState, to: newState });
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      totalCalls: this.totalCalls,
      rejectedCalls: this.rejectedCalls,
    };
  }

  /**
   * Check if circuit is allowing calls
   */
  isCallAllowed(): boolean {
    if (this.state === 'OPEN') {
      return false;
    }
    if (this.state === 'HALF_OPEN') {
      return this.halfOpenCalls < this.config.halfOpenMaxCalls;
    }
    return true; // CLOSED state
  }

  /**
   * Reset all statistics and state
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.totalCalls = 0;
    this.rejectedCalls = 0;
    this.halfOpenCalls = 0;
    this.clearResetTimer();
    this.removeAllListeners();
  }

  /**
   * Simulate multiple failures to trigger circuit opening
   */
  simulateFailures(count: number): void {
    // Ensure we have enough total calls to meet minimum throughput
    if (this.totalCalls < this.config.minimumThroughput) {
      this.totalCalls = this.config.minimumThroughput;
    }
    
    for (let i = 0; i < count; i++) {
      this.totalCalls++; // Increment totalCalls to meet minimumThroughput requirement
      this.onFailure(new Error('Simulated failure'), 'simulatedOperation');
    }
  }

  /**
   * Simulate multiple successes
   */
  simulateSuccesses(count: number): void {
    for (let i = 0; i < count; i++) {
      this.onSuccess('simulatedOperation');
    }
  }

  /**
   * Get configuration
   */
  getConfig(): Required<CircuitBreakerConfig> {
    return { ...this.config };
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.clearResetTimer();
    this.removeAllListeners();
  }
}