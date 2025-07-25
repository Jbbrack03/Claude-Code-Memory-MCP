import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { HookSystem, type HookConfig } from "../../src/hooks/system.js";

describe('HookSystem', () => {
  let system: HookSystem;
  let mockConfig: HookConfig;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with executor and circuit breaker', async () => {
      // Given: Hook system configuration
      mockConfig = {
        hooks: {},
        sandbox: {
          enabled: true,
          allowedCommands: ['echo', 'node'],
          env: { NODE_ENV: 'test' }
        },
        execution: {
          timeout: 5000,
          maxMemory: '100MB',
          maxCpu: 1
        },
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeout: 60000,
          halfOpenRequests: 3
        }
      };
      
      system = new HookSystem(mockConfig);
      
      // When: Initializing
      await system.initialize();
      
      // Then: System is ready
      await expect(system.executeHook({
        type: 'test',
        data: {},
        timestamp: new Date()
      })).resolves.toBeDefined();
    });

    it('should throw if not initialized', async () => {
      // Given: Uninitialized system
      system = new HookSystem({ hooks: {} });
      
      // When/Then: Executing without initialization throws
      await expect(system.executeHook({
        type: 'test',
        data: {},
        timestamp: new Date()
      })).rejects.toThrow('Hook system not initialized');
    });
  });

  describe('hook registration', () => {
    it('should match hooks by tool pattern', async () => {
      // Given: Hook configuration
      mockConfig = {
        hooks: {
          PreToolUse: [{
            matcher: '^(Write|Edit)$',
            command: 'node -e "console.log(\'File operation:\', process.env.TOOL_NAME)"'
          }]
        },
        sandbox: {
          enabled: true,
          allowedCommands: ['node'],
          env: {}
        }
      };
      
      system = new HookSystem(mockConfig);
      await system.initialize();
      
      // When: Write tool is used
      const result = await system.executeHook({
        type: 'PreToolUse',
        tool: 'Write',
        data: { file_path: 'test.ts' },
        timestamp: new Date()
      });
      
      // Then: Hook executes
      expect(result).toBeDefined();
      expect(result?.output).toContain('File operation: Write');
    });

    it('should skip hooks that dont match', async () => {
      // Given: Hook with specific matcher
      mockConfig = {
        hooks: {
          PreToolUse: [{
            matcher: '^Read$',
            command: 'echo "Reading"'
          }]
        },
        sandbox: {
          enabled: true,
          allowedCommands: ['echo'],
          env: {}
        }
      };
      
      system = new HookSystem(mockConfig);
      await system.initialize();
      
      // When: Different tool is used
      const result = await system.executeHook({
        type: 'PreToolUse',
        tool: 'Write',
        data: {},
        timestamp: new Date()
      });
      
      // Then: No hook executes
      expect(result).toBeNull();
    });

    it('should execute multiple matching hooks', async () => {
      // Given: Multiple hooks for same event
      mockConfig = {
        hooks: {
          PostToolUse: [
            {
              matcher: '.*',
              command: 'echo "Hook 1"'
            },
            {
              matcher: 'Write',
              command: 'echo "Hook 2"'
            }
          ]
        },
        sandbox: {
          enabled: true,
          allowedCommands: ['echo'],
          env: {}
        }
      };
      
      system = new HookSystem(mockConfig);
      await system.initialize();
      
      // When: Event matches multiple hooks
      const result = await system.executeHook({
        type: 'PostToolUse',
        tool: 'Write',
        data: {},
        timestamp: new Date()
      });
      
      // Then: All matching hooks execute
      expect(result).toBeDefined();
      expect(result?.results).toHaveLength(2);
      expect(result?.results?.[0]?.output).toContain('Hook 1');
      expect(result?.results?.[1]?.output).toContain('Hook 2');
    });
  });

  describe('environment variables', () => {
    it('should provide hook context as environment variables', async () => {
      // Given: Hook that uses environment variables
      mockConfig = {
        hooks: {
          PreToolUse: [{
            matcher: '.*',
            command: 'node -e "console.log(process.env.TOOL_NAME, process.env.TOOL_INPUT_file_path)"'
          }]
        },
        sandbox: {
          enabled: true,
          allowedCommands: ['node'],
          env: {}
        }
      };
      
      system = new HookSystem(mockConfig);
      await system.initialize();
      
      // When: Hook executes with context
      const result = await system.executeHook({
        type: 'PreToolUse',
        tool: 'Write',
        data: { file_path: '/src/test.ts', content: 'test' },
        timestamp: new Date()
      });
      
      // Then: Environment variables are available
      expect(result?.output).toContain('Write /src/test.ts');
    });

    it('should sanitize sensitive data from environment', async () => {
      // Given: Hook with sensitive data
      mockConfig = {
        hooks: {
          PreToolUse: [{
            matcher: '.*',
            command: 'node -e "console.log(JSON.stringify(process.env))"'
          }]
        },
        sandbox: {
          enabled: true,
          allowedCommands: ['node'],
          env: {}
        }
      };
      
      system = new HookSystem(mockConfig);
      await system.initialize();
      
      // When: Hook executes with sensitive data
      const result = await system.executeHook({
        type: 'PreToolUse',
        tool: 'APICall',
        data: { api_key: 'secret123', endpoint: 'test' },
        timestamp: new Date()
      });
      
      // Then: Sensitive data is not exposed
      expect(result?.output).not.toContain('secret123');
      expect(result?.output).toContain('endpoint');
    });
  });

  describe('error handling', () => {
    it('should capture hook errors without blocking', async () => {
      // Given: Failing hook
      mockConfig = {
        hooks: {
          PostToolUse: [{
            matcher: '.*',
            command: 'node -e "process.exit(1)"'
          }]
        },
        sandbox: {
          enabled: true,
          allowedCommands: ['node'],
          env: {}
        }
      };
      
      system = new HookSystem(mockConfig);
      await system.initialize();
      
      // When: Hook executes
      const result = await system.executeHook({
        type: 'PostToolUse',
        tool: 'Write',
        data: {},
        timestamp: new Date()
      });
      
      // Then: Error is captured but not thrown
      expect(result).toBeDefined();
      expect(result?.error).toBeDefined();
      expect(result?.exitCode).toBe(1);
    });

    it('should handle timeout gracefully', async () => {
      // Given: Slow hook
      mockConfig = {
        hooks: {
          PreToolUse: [{
            matcher: '.*',
            command: 'sleep 10'
          }]
        },
        sandbox: {
          enabled: true,
          allowedCommands: ['sleep'],
          env: {}
        },
        execution: {
          timeout: 100, // 100ms
          maxMemory: '100MB',
          maxCpu: 1
        }
      };
      
      system = new HookSystem(mockConfig);
      await system.initialize();
      
      // When: Hook times out
      const result = await system.executeHook({
        type: 'PreToolUse',
        tool: 'Test',
        data: {},
        timestamp: new Date()
      });
      
      // Then: Timeout is handled
      expect(result?.error).toContain('timed out');
    });

    it('should respect circuit breaker for failing hooks', async () => {
      // Given: Hook that fails repeatedly
      mockConfig = {
        hooks: {
          PreToolUse: [{
            matcher: '.*',
            command: 'node -e "process.exit(1)"',
            id: 'failing-hook'
          }]
        },
        sandbox: {
          enabled: true,
          allowedCommands: ['node'],
          env: {}
        },
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 60000,
          halfOpenRequests: 3
        }
      };
      
      system = new HookSystem(mockConfig);
      await system.initialize();
      
      // When: Hook fails twice
      await system.executeHook({ type: 'PreToolUse', tool: 'Test', data: {}, timestamp: new Date() });
      await system.executeHook({ type: 'PreToolUse', tool: 'Test', data: {}, timestamp: new Date() });
      
      // Then: Third execution is blocked
      const result = await system.executeHook({ 
        type: 'PreToolUse', 
        tool: 'Test', 
        data: {},
        timestamp: new Date()
      });
      expect(result?.skipped).toBe(true);
      expect(result?.reason).toBe('Circuit breaker open');
    });
  });

  describe('hook output validation', () => {
    it('should validate JSON output when expected', async () => {
      // Given: Hook that outputs JSON
      mockConfig = {
        hooks: {
          PreToolUse: [{
            matcher: '.*',
            command: 'echo \'{"valid": true}\'',
            outputFormat: 'json'
          }]
        },
        sandbox: {
          enabled: true,
          allowedCommands: ['echo'],
          env: {}
        }
      };
      
      system = new HookSystem(mockConfig);
      await system.initialize();
      
      // When: Hook executes
      const result = await system.executeHook({
        type: 'PreToolUse',
        tool: 'Test',
        data: {},
        timestamp: new Date()
      });
      
      // Then: JSON is parsed
      expect(result?.parsed).toEqual({ valid: true });
    });

    it('should handle invalid JSON gracefully', async () => {
      // Given: Hook that outputs invalid JSON
      mockConfig = {
        hooks: {
          PreToolUse: [{
            matcher: '.*',
            command: 'echo "not json"',
            outputFormat: 'json'
          }]
        },
        sandbox: {
          enabled: true,
          allowedCommands: ['echo'],
          env: {}
        }
      };
      
      system = new HookSystem(mockConfig);
      await system.initialize();
      
      // When: Hook executes
      const result = await system.executeHook({
        type: 'PreToolUse',
        tool: 'Test',
        data: {},
        timestamp: new Date()
      });
      
      // Then: Error is captured
      expect(result?.parseError).toBeDefined();
      expect(result?.output).toBe('not json\n');
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on close', async () => {
      // Given: Initialized system
      mockConfig = {
        hooks: {},
        sandbox: {
          enabled: true,
          allowedCommands: ['echo'],
          env: {}
        }
      };
      
      system = new HookSystem(mockConfig);
      await system.initialize();
      
      // When: Closing
      await system.close();
      
      // Then: Cannot execute hooks
      await expect(system.executeHook({
        type: 'test',
        data: {},
        timestamp: new Date()
      })).rejects.toThrow('Hook system not initialized');
    });
  });
});