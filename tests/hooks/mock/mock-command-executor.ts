/**
 * Mock command executor for testing hook command execution
 */

import { EventEmitter } from 'events';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
}

export interface ExecutorConfig {
  timeout?: number;
  allowedCommands?: string[];
  simulateFailures?: boolean;
  failureRate?: number;
  simulateLatency?: number;
}

export class MockCommandExecutor extends EventEmitter {
  private config: Required<ExecutorConfig>;
  private commandHistory: Array<{
    command: string;
    timestamp: string;
    result: CommandResult;
  }> = [];

  // Predefined command responses for consistent testing
  private commandResponses: Record<string, Partial<CommandResult>> = {
    'echo "hello"': { stdout: 'hello\n', exitCode: 0 },
    'echo "test"': { stdout: 'test\n', exitCode: 0 },
    'ls -la': { 
      stdout: 'total 0\ndrwxr-xr-x  2 user  group   64 Jan  1 12:00 .\ndrwxr-xr-x  3 user  group   96 Jan  1 12:00 ..\n',
      exitCode: 0 
    },
    'cat nonexistent.txt': { 
      stderr: 'cat: nonexistent.txt: No such file or directory\n',
      exitCode: 1 
    },
    'git status': {
      stdout: 'On branch main\nnothing to commit, working tree clean\n',
      exitCode: 0
    },
    'npm --version': { stdout: '10.2.4\n', exitCode: 0 },
    'node --version': { stdout: 'v20.10.0\n', exitCode: 0 },
  };

  constructor(config: ExecutorConfig = {}) {
    super();
    this.config = {
      timeout: config.timeout ?? 5000,
      allowedCommands: config.allowedCommands ?? ['echo', 'ls', 'cat', 'git', 'npm', 'node', 'sleep'],
      simulateFailures: config.simulateFailures ?? false,
      failureRate: config.failureRate ?? 0.1,
      simulateLatency: config.simulateLatency ?? 0,
    };
  }

  /**
   * Execute a command with mocked behavior
   */
  async execute(command: string): Promise<CommandResult> {
    const startTime = Date.now();
    this.emit('commandStart', { command, timestamp: new Date().toISOString() });

    // Check if command is allowed
    if (!this.isCommandAllowed(command)) {
      const error = new Error(`Command not allowed: ${command.split(' ')[0]}`);
      this.emit('commandError', { command, error });
      throw error;
    }

    // Simulate timeout
    if (command.includes('sleep') || command.includes('hang')) {
      throw new Error(`Command timed out after ${this.config.timeout}ms`);
    }

    // Simulate latency
    if (this.config.simulateLatency > 0) {
      await this.sleep(this.config.simulateLatency);
    }

    // Simulate random failures
    if (this.config.simulateFailures && Math.random() < this.config.failureRate) {
      const realExecutionTime = Date.now() - startTime;
      const result: CommandResult = {
        stdout: '',
        stderr: 'Simulated command failure\n',
        exitCode: 1,
        executionTime: Math.max(realExecutionTime, 1),
      };
      this.recordCommand(command, result);
      return result;
    }

    // Get predefined response or generate default
    const result = this.getCommandResult(command, startTime);
    this.recordCommand(command, result);
    
    this.emit('commandComplete', { command, result });
    return result;
  }

  /**
   * Check if command is in allowed list
   */
  private isCommandAllowed(command: string): boolean {
    const commandName = command.split(' ')[0];
    // Allow custom commands that have been explicitly added
    if (this.commandResponses[command] || this.commandResponses[commandName]) {
      return true;
    }
    return this.config.allowedCommands.includes(commandName);
  }

  /**
   * Get command result from predefined responses or generate default
   */
  private getCommandResult(command: string, startTime: number): CommandResult {
    const realExecutionTime = Date.now() - startTime;
    // Ensure minimum execution time for realistic stats
    const executionTime = Math.max(realExecutionTime, 1);
    
    // Check for exact matches first
    if (this.commandResponses[command]) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        executionTime,
        ...this.commandResponses[command],
      };
    }

    // Pattern matching for common commands
    if (command.startsWith('echo ')) {
      const content = command.substring(5).replace(/"/g, '');
      return {
        stdout: `${content}\n`,
        stderr: '',
        exitCode: 0,
        executionTime,
      };
    }

    if (command.startsWith('cat ')) {
      const filename = command.substring(4);
      if (filename.includes('error') || filename.includes('nonexistent')) {
        return {
          stdout: '',
          stderr: `cat: ${filename}: No such file or directory\n`,
          exitCode: 1,
          executionTime,
        };
      }
      return {
        stdout: `Mock content of ${filename}\n`,
        stderr: '',
        exitCode: 0,
        executionTime,
      };
    }

    if (command.startsWith('ls')) {
      return {
        stdout: 'file1.txt\nfile2.js\ndirectory/\n',
        stderr: '',
        exitCode: 0,
        executionTime,
      };
    }

    // Default successful response
    return {
      stdout: `Mock output for: ${command}\n`,
      stderr: '',
      exitCode: 0,
      executionTime,
    };
  }

  /**
   * Record command execution in history
   */
  private recordCommand(command: string, result: CommandResult): void {
    this.commandHistory.push({
      command,
      timestamp: new Date().toISOString(),
      result,
    });

    // Keep only last 100 commands
    if (this.commandHistory.length > 100) {
      this.commandHistory = this.commandHistory.slice(-100);
    }
  }

  /**
   * Add custom command response
   */
  addCommandResponse(command: string, response: Partial<CommandResult>): void {
    this.commandResponses[command] = response;
  }

  /**
   * Get command execution history
   */
  getHistory(): typeof this.commandHistory {
    return [...this.commandHistory];
  }

  /**
   * Get execution statistics
   */
  getStats() {
    const successCount = this.commandHistory.filter(entry => entry.result.exitCode === 0).length;
    const failureCount = this.commandHistory.length - successCount;
    const avgExecutionTime = this.commandHistory.length > 0
      ? this.commandHistory.reduce((sum, entry) => sum + entry.result.executionTime, 0) / this.commandHistory.length
      : 0;

    return {
      totalCommands: this.commandHistory.length,
      successCount,
      failureCount,
      successRate: this.commandHistory.length > 0 ? successCount / this.commandHistory.length : 0,
      avgExecutionTime,
      config: { ...this.config },
    };
  }

  /**
   * Clear history and reset state
   */
  reset(): void {
    this.commandHistory = [];
    this.removeAllListeners();
  }

  /**
   * Sleep utility for simulating latency
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}