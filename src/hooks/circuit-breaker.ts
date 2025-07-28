import { createLogger } from "../utils/logger.js";

const logger = createLogger("CircuitBreaker");

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenRequests?: number;
}

interface CircuitState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  successes: number;
  consecutiveFailures: number; // For circuit breaking logic
  lastFailureTime?: number;
  halfOpenAttempts?: number;
  pendingRequests?: number; // Track in-flight requests
}

interface CircuitStats extends CircuitState {
  totalRequests: number;
}

export class CircuitBreaker {
  private config: Required<CircuitBreakerConfig>;
  private circuits: Map<string, CircuitState> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: CircuitBreakerConfig = {}) {
    // Validate configuration
    if (config.failureThreshold !== undefined && config.failureThreshold < 1) {
      throw new Error('Failure threshold must be at least 1');
    }
    if (config.resetTimeout !== undefined && config.resetTimeout <= 0) {
      throw new Error('Reset timeout must be positive');
    }
    if (config.halfOpenRequests !== undefined && config.halfOpenRequests < 1) {
      throw new Error('Half-open requests must be at least 1');
    }

    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeout: config.resetTimeout ?? 60000, // 60 seconds
      halfOpenRequests: config.halfOpenRequests ?? 3
    };
  }

  async execute<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    const circuit = this.getCircuit(operationName);

    // Check if circuit is open
    if (circuit.state === 'open') {
      throw new Error('Circuit breaker is open');
    }

    // For half-open state, we need to check if we've exceeded allowed attempts
    if (circuit.state === 'half-open') {
      const attempts = circuit.halfOpenAttempts || 0;
      if (attempts >= this.config.halfOpenRequests) {
        // Still in half-open but waiting for results
        throw new Error('Circuit breaker is open');
      }
    }

    // Check if we would exceed threshold with pending requests
    if (circuit.state === 'closed') {
      const pending = circuit.pendingRequests || 0;
      if (circuit.consecutiveFailures + pending >= this.config.failureThreshold) {
        throw new Error('Circuit breaker is open');
      }
    }

    // Increment pending requests
    circuit.pendingRequests = (circuit.pendingRequests || 0) + 1;

    try {
      // Execute the operation
      const result = await operation();
      
      // Decrement pending
      circuit.pendingRequests = Math.max(0, (circuit.pendingRequests || 0) - 1);
      
      // Record success
      this.recordSuccess(operationName);
      
      return result;
    } catch (error) {
      // Decrement pending
      circuit.pendingRequests = Math.max(0, (circuit.pendingRequests || 0) - 1);
      
      // Record failure
      this.recordFailure(operationName);
      
      throw error;
    }
  }

  getState(operationName: string): 'closed' | 'open' | 'half-open' {
    return this.getCircuit(operationName).state;
  }

  getStats(operationName: string): CircuitStats {
    const circuit = this.getCircuit(operationName);
    return {
      ...circuit,
      totalRequests: circuit.failures + circuit.successes
    };
  }

  getAllStats(): Record<string, CircuitStats> {
    const stats: Record<string, CircuitStats> = {};
    
    for (const [name, circuit] of this.circuits) {
      stats[name] = {
        ...circuit,
        totalRequests: circuit.failures + circuit.successes
      };
    }
    
    return stats;
  }

  reset(operationName?: string): void {
    if (operationName) {
      // Reset specific circuit
      this.circuits.delete(operationName);
      const timer = this.timers.get(operationName);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(operationName);
      }
    } else {
      // Reset all circuits
      this.circuits.clear();
      for (const timer of this.timers.values()) {
        clearTimeout(timer);
      }
      this.timers.clear();
    }
  }

  private getCircuit(operationName: string): CircuitState {
    if (!this.circuits.has(operationName)) {
      this.circuits.set(operationName, {
        state: 'closed',
        failures: 0,
        successes: 0,
        consecutiveFailures: 0,
        pendingRequests: 0
      });
    }
    const circuit = this.circuits.get(operationName);
    if (!circuit) {
      throw new Error(`Circuit ${operationName} not found`);
    }
    return circuit;
  }

  private recordSuccess(operationName: string): void {
    const circuit = this.getCircuit(operationName);
    circuit.successes++;

    if (circuit.state === 'half-open') {
      circuit.halfOpenAttempts = (circuit.halfOpenAttempts || 0) + 1;
      
      if (circuit.halfOpenAttempts >= this.config.halfOpenRequests) {
        // Close the circuit after successful half-open requests
        logger.info(`Circuit for ${operationName} closed after successful half-open period`);
        circuit.state = 'closed';
        circuit.consecutiveFailures = 0;
        circuit.halfOpenAttempts = 0;
        delete circuit.lastFailureTime;
      }
    } else if (circuit.state === 'closed') {
      // Reset consecutive failure count on success
      circuit.consecutiveFailures = 0;
    }
  }

  private recordFailure(operationName: string): void {
    const circuit = this.getCircuit(operationName);
    circuit.failures++;
    circuit.consecutiveFailures++;
    circuit.lastFailureTime = Date.now();

    if (circuit.state === 'half-open') {
      // Return to open state
      logger.warn(`Circuit for ${operationName} returned to open state after half-open failure`);
      circuit.state = 'open';
      circuit.halfOpenAttempts = 0;
      this.scheduleReset(operationName);
    } else if (circuit.state === 'closed' && circuit.consecutiveFailures >= this.config.failureThreshold) {
      // Open the circuit
      logger.warn(`Circuit for ${operationName} opened after ${circuit.consecutiveFailures} failures`);
      circuit.state = 'open';
      this.scheduleReset(operationName);
    }
  }

  private scheduleReset(operationName: string): void {
    // Clear any existing timer
    const existingTimer = this.timers.get(operationName);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule transition to half-open
    const timer = setTimeout(() => {
      const circuit = this.getCircuit(operationName);
      if (circuit.state === 'open') {
        logger.info(`Circuit for ${operationName} entering half-open state`);
        circuit.state = 'half-open';
        circuit.halfOpenAttempts = 0;
      }
      this.timers.delete(operationName);
    }, this.config.resetTimeout);

    this.timers.set(operationName, timer);
  }
}