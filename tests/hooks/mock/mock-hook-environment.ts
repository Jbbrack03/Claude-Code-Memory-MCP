/**
 * Mock hook environment for testing hook templates
 * Simulates Claude Code hook execution environment
 */

import { EventEmitter } from 'events';
import { HookEvent, HookResponse } from '../../../src/hooks/templates/base-template.js';

export interface MockEnvironmentConfig {
  timeout?: number;
  allowedCommands?: string[];
  maxMemoryUsage?: number;
  enableSandbox?: boolean;
  simulateLatency?: number;
  failureRate?: number;
}

export interface MockHookContext {
  workspacePath?: string;
  sessionId?: string;
  userId?: string;
  environment?: Record<string, string>;
}

export class MockHookEnvironment extends EventEmitter {
  private config: Required<MockEnvironmentConfig>;
  private executionCount = 0;
  private failureSimulation = false;

  constructor(config: MockEnvironmentConfig = {}) {
    super();
    this.config = {
      timeout: config.timeout ?? 5000,
      allowedCommands: config.allowedCommands ?? ['echo', 'ls', 'cat'],
      maxMemoryUsage: config.maxMemoryUsage ?? 1024 * 1024 * 100, // 100MB
      enableSandbox: config.enableSandbox ?? true,
      simulateLatency: config.simulateLatency ?? 0,
      failureRate: config.failureRate ?? 0,
    };
  }

  /**
   * Create a mock hook event for testing
   */
  createMockEvent(
    type: string,
    data: Record<string, unknown>,
    context?: MockHookContext
  ): HookEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      data,
      context: {
        workspacePath: context?.workspacePath ?? '/mock/workspace',
        sessionId: context?.sessionId ?? 'mock-session-123',
        userId: context?.userId ?? 'mock-user',
        environment: context?.environment ?? {
          NODE_ENV: 'test',
          PATH: '/usr/bin:/bin',
        },
      },
    };
  }

  /**
   * Simulate hook execution with environment constraints
   */
  async executeHook(
    hookFn: (event: HookEvent) => Promise<HookResponse>,
    event: HookEvent
  ): Promise<HookResponse> {
    this.executionCount++;
    this.emit('hookExecutionStart', { event, executionCount: this.executionCount });

    // Simulate failure rate
    if (this.config.failureRate > 0) {
      const shouldFail = Math.random() < this.config.failureRate;
      if (shouldFail) {
        this.failureSimulation = true;
        throw new Error(`Simulated failure (rate: ${this.config.failureRate})`);
      }
    }

    // Start timing before latency simulation
    const startTime = Date.now();

    // Simulate latency
    if (this.config.simulateLatency > 0) {
      await this.sleep(this.config.simulateLatency);
    }

    // Execute with timeout
    let response: HookResponse;

    try {
      response = await this.withTimeout(
        hookFn(event),
        this.config.timeout,
        'Hook execution'
      );
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.emit('hookExecutionError', { event, error, executionTime });
      throw error;
    }

    const executionTime = Date.now() - startTime;
    
    // Update response metadata with actual execution time
    if (response.metadata) {
      response.metadata.executionTime = executionTime;
    }

    this.emit('hookExecutionComplete', { event, response, executionTime });
    return response;
  }

  /**
   * Validate command against sandbox rules
   */
  validateCommand(command: string): boolean {
    if (!this.config.enableSandbox) {
      return true;
    }

    const commandName = command.split(' ')[0];
    return this.config.allowedCommands.includes(commandName);
  }

  /**
   * Simulate memory usage check
   */
  checkMemoryUsage(): { current: number; limit: number; isWithinLimit: boolean } {
    const mockUsage = Math.floor(Math.random() * this.config.maxMemoryUsage * 0.8);
    return {
      current: mockUsage,
      limit: this.config.maxMemoryUsage,
      isWithinLimit: mockUsage < this.config.maxMemoryUsage,
    };
  }

  /**
   * Get execution statistics
   */
  getStats() {
    return {
      executionCount: this.executionCount,
      failureSimulation: this.failureSimulation,
      config: { ...this.config },
    };
  }

  /**
   * Reset environment state
   */
  reset(): void {
    this.executionCount = 0;
    this.failureSimulation = false;
    this.removeAllListeners();
  }

  /**
   * Create a timeout promise
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operation: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Sleep utility for simulating latency
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}