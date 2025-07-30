import { createLogger } from "../utils/logger.js";
import { spawn, ChildProcess } from "child_process";

const logger = createLogger("HookExecutor");

export interface ExecutorConfig {
  sandbox?: {
    allowedCommands?: string[];
    env?: Record<string, string>;
  };
  execution?: {
    timeout?: number;
    cwd?: string;
    maxMemory?: string;
  };
}

export interface ExecutionContext {
  context?: Record<string, string>;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class HookExecutor {
  private config: Required<ExecutorConfig>;
  private processes: Set<ChildProcess> = new Set();

  constructor(config: ExecutorConfig) {
    // Validate configuration
    if (!config.sandbox?.allowedCommands || config.sandbox.allowedCommands.length === 0) {
      throw new Error('At least one allowed command must be specified');
    }

    // Set defaults
    this.config = {
      sandbox: {
        allowedCommands: config.sandbox?.allowedCommands || [],
        env: config.sandbox?.env || {}
      },
      execution: {
        timeout: config.execution?.timeout || 30000, // 30 seconds default
        cwd: config.execution?.cwd || process.cwd(),
        maxMemory: config.execution?.maxMemory || '128MB'
      }
    };
  }

  async execute(command: string, options: ExecutionContext = {}): Promise<ExecutionResult> {
    if (!command || command.trim() === '') {
      throw new Error('Command cannot be empty');
    }

    logger.debug(`Executing command: ${command}`);

    // Parse command
    const parts = this.parseCommand(command);
    if (parts.length === 0) {
      throw new Error('Invalid command');
    }
    const cmd = parts[0];
    if (!cmd) {
      throw new Error('Command is empty');
    }
    const args = parts.slice(1);

    // Check if command is allowed
    if (!this.isCommandAllowed(cmd)) {
      throw new Error(`Command not allowed: ${cmd}`);
    }

    // Build environment
    const env = this.buildEnvironment(options.context);

    // Execute command
    return await this.executeCommand(cmd, args, env);
  }

  private parseCommand(command: string): string[] {
    // Enhanced command parsing with security checks
    // Check for dangerous patterns including command substitution
    const dangerousPatterns = [';', '&&', '||', '|', '>', '<', '\n', '\r'];
    let inQuotes = false;
    let quoteChar = '';
    let hasInjection = false;
    
    // First pass: check for command substitution and dangerous patterns
    for (let i = 0; i < command.length; i++) {
      const char = command[i];
      const prevChar = i > 0 ? command[i-1] : '';
      
      // Track quote state
      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = '';
        }
      }
      
      // Check for backticks (command substitution)
      if (char === '`') {
        hasInjection = true;
        break;
      }
      
      // Check for $(...) command substitution
      if (char === '$' && i + 1 < command.length && command[i + 1] === '(') {
        hasInjection = true;
        break;
      }
      
      // Check dangerous patterns outside quotes
      if (!inQuotes && dangerousPatterns.some(p => command.substring(i).startsWith(p))) {
        hasInjection = true;
        break;
      }
    }
    
    if (hasInjection) {
      throw new Error(`Command not allowed: ${command}`);
    }

    // Second pass: parse command into parts
    const parts: string[] = [];
    let current = '';
    inQuotes = false;
    quoteChar = '';

    for (let i = 0; i < command.length; i++) {
      const char = command[i];
      
      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  private isCommandAllowed(command: string): boolean {
    return this.config.sandbox.allowedCommands?.includes(command) ?? false;
  }

  private buildEnvironment(context?: Record<string, string>): Record<string, string> {
    // Start with allowed env vars only
    const env: Record<string, string> = {
      ...this.config.sandbox.env
    };

    // Add context variables
    if (context) {
      Object.assign(env, context);
    }

    // Ensure PATH is set if not explicitly provided
    if (!env.PATH) {
      // Include common paths including where node is typically installed
      env.PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
    }

    return env;
  }

  private async executeCommand(
    cmd: string, 
    args: string[], 
    env: Record<string, string>
  ): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: this.config.execution.cwd,
        env,
        // Don't inherit parent process env
        shell: false,
        windowsHide: true
      });

      this.processes.add(child);

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Set up timeout
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Force kill after grace period
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 1000).unref();
      }, this.config.execution.timeout);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        this.processes.delete(child);
        
        if (error.message.includes('ENOENT')) {
          reject(new Error(`Command not found: ${cmd}`));
        } else {
          reject(new Error(`Command failed: ${error.message}`));
        }
      });

      child.on('exit', (code) => {
        clearTimeout(timeout);
        this.processes.delete(child);

        if (timedOut) {
          reject(new Error(`Command timed out after ${this.config.execution.timeout}ms`));
          return;
        }

        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1
        });
      });
    });
  }

  cleanup(): void {
    // Kill any remaining processes
    for (const proc of this.processes) {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
    }
    this.processes.clear();
  }
}