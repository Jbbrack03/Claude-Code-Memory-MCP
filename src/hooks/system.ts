import { createLogger } from "../utils/logger.js";
import type { Config } from "../config/index.js";
import { HookExecutor, type ExecutorConfig } from "./executor.js";
import { CircuitBreaker } from "./circuit-breaker.js";

const logger = createLogger("HookSystem");

export interface HookDefinition {
  matcher: string;
  command: string;
  id?: string;
  outputFormat?: 'text' | 'json';
}

export interface HookConfig {
  hooks?: Record<string, HookDefinition[]>;
  execution?: Config["hooks"]["execution"];
  circuitBreaker?: Config["hooks"]["circuitBreaker"];
  sandbox?: Config["hooks"]["sandbox"];
}

export interface HookEvent {
  type: string;
  tool?: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

export interface HookResult {
  output?: string;
  parsed?: unknown;
  error?: string;
  exitCode?: number;
  skipped?: boolean;
  reason?: string;
  results?: HookResult[];
  parseError?: string;
}

export class HookSystem {
  private initialized = false;
  private executor?: HookExecutor;
  private circuitBreaker?: CircuitBreaker;
  private hooks: Map<string, HookDefinition[]> = new Map();
  private config: Required<Config["hooks"]>;

  constructor(config: HookConfig) {
    // Merge with defaults
    this.config = {
      execution: config.execution || {
        timeout: 5000,
        maxMemory: "100MB",
        maxCpu: 1
      },
      circuitBreaker: config.circuitBreaker || {
        failureThreshold: 5,
        resetTimeout: 60000,
        halfOpenRequests: 3
      },
      sandbox: config.sandbox || {
        enabled: true,
        allowedCommands: ["echo", "date"],
        env: {}
      }
    };

    // Register hooks
    if (config.hooks) {
      for (const [eventType, hookDefs] of Object.entries(config.hooks)) {
        this.hooks.set(eventType, hookDefs);
      }
    }
  }

  initialize(): void {
    logger.info("Initializing hook system...");
    
    // Initialize executor with sandbox config
    const executorConfig: ExecutorConfig = {
      sandbox: {
        allowedCommands: this.config.sandbox.allowedCommands,
        env: this.config.sandbox.env
      },
      execution: {
        timeout: this.config.execution.timeout,
        cwd: process.cwd(),
        maxMemory: this.config.execution.maxMemory
      }
    };
    
    this.executor = new HookExecutor(executorConfig);
    
    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker(this.config.circuitBreaker);
    
    this.initialized = true;
    logger.info("Hook system initialized");
  }

  async executeHook(event: HookEvent): Promise<HookResult | null> {
    if (!this.initialized || !this.executor || !this.circuitBreaker) {
      throw new Error("Hook system not initialized");
    }

    logger.debug("Executing hook", { type: event.type, tool: event.tool });
    
    // Find matching hooks
    const eventHooks = this.hooks.get(event.type) || [];
    const matchingHooks = eventHooks.filter(hook => this.matchesHook(hook, event));
    
    if (matchingHooks.length === 0) {
      return null;
    }
    
    // Execute all matching hooks
    const results: HookResult[] = [];
    
    for (const hook of matchingHooks) {
      const hookId = hook.id || `${event.type}-${hook.matcher}`;
      
      try {
        // Check circuit breaker
        const result = await this.circuitBreaker.execute(hookId, async () => {
          // Build environment variables
          const env = this.buildEnvironment(event);
          
          // Execute hook
          if (!this.executor) {
            throw new Error("Hook executor not initialized");
          }
          const execResult = await this.executor.execute(hook.command, { context: env });
          
          // Parse output if needed
          let parsed: unknown;
          let parseError: string | undefined;
          if (hook.outputFormat === 'json' && execResult.stdout) {
            try {
              parsed = JSON.parse(execResult.stdout.trim());
            } catch (error: unknown) {
              parseError = error instanceof Error ? error.message : String(error);
            }
          }
          
          const result = {
            output: execResult.stdout,
            error: execResult.stderr,
            exitCode: execResult.exitCode,
            parsed,
            parseError
          };
          
          // Check for non-zero exit code and throw for circuit breaker
          if (execResult.exitCode !== 0) {
            throw result; // Throw the result object so we can still return it
          }
          
          return result;
        });
        
        results.push(result);
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'Circuit breaker is open') {
          results.push({
            skipped: true,
            reason: 'Circuit breaker open'
          });
        } else if (typeof error === 'object' && error !== null && 'exitCode' in error) {
          // This is a thrown result object from a failed hook
          results.push(error as HookResult);
        } else {
          results.push({
            error: error instanceof Error ? error.message : String(error),
            exitCode: 1
          });
        }
      }
    }
    
    // Return single result or multiple
    if (results.length === 1) {
      return results[0] || null;
    } else {
      return { results };
    }
  }

  close(): void {
    logger.info("Closing hook system...");
    
    if (this.executor) {
      this.executor.cleanup();
    }
    
    this.initialized = false;
    logger.info("Hook system closed");
  }

  private matchesHook(hook: HookDefinition, event: HookEvent): boolean {
    if (!event.tool) {
      // Non-tool events always match if hook exists
      return true;
    }
    
    try {
      const regex = new RegExp(hook.matcher);
      return regex.test(event.tool);
    } catch (error) {
      logger.error(`Invalid hook matcher: ${hook.matcher}`, error);
      return false;
    }
  }

  private buildEnvironment(event: HookEvent): Record<string, string> {
    const env: Record<string, string> = {
      HOOK_TYPE: event.type,
      TIMESTAMP: event.timestamp.toISOString()
    };
    
    if (event.tool) {
      env.TOOL_NAME = event.tool;
    }
    
    // Add tool input data as environment variables
    if (event.data && typeof event.data === 'object') {
      for (const [key, value] of Object.entries(event.data)) {
        // Skip sensitive data
        if (this.isSensitiveKey(key)) {
          continue;
        }
        
        const envKey = `TOOL_INPUT_${key}`;
        env[envKey] = String(value);
      }
    }
    
    return env;
  }

  private isSensitiveKey(key: string): boolean {
    const sensitivePatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /key/i,
      /auth/i,
      /credential/i
    ];
    
    return sensitivePatterns.some(pattern => pattern.test(key));
  }
}