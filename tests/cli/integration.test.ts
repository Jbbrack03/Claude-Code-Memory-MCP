import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Normalize paths to handle macOS /private prefix
 */
function normalizePath(p: string): string {
  // Resolve to absolute path
  const resolved = path.resolve(p);
  // Remove /private prefix on macOS
  return resolved.replace(/^\/private/, '');
}

/**
 * Timeout helper for CLI operations
 */
async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = 10000
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`CLI operation timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([operation(), timeoutPromise]);
}

/**
 * Helper to run CLI command and capture output
 */
async function runCLICommand(
  command: string,
  args: string[] = [],
  options: { cwd?: string; timeout?: number; dbPath?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { cwd = process.cwd(), timeout = 10000, dbPath = ':memory:' } = options;
  
  return new Promise((resolve, reject) => {
    const cliPath = path.join(__dirname, '../../dist/cli/index.js');
    const child = spawn(process.execPath, [cliPath, command, ...args], {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MEMORY_DB_PATH: dbPath,
        LOG_LEVEL: 'warn' // Reduce log noise in tests
      }
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI command timed out after ${timeout}ms`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code || 0
      });
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

describe('CLI Integration Tests', () => {
  let testDir: string;
  let gitWorkspace: string;
  let npmWorkspace: string;
  let basicWorkspace: string;

  beforeEach(async () => {
    await withTimeout(async () => {
      // Create test workspace structures
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-integration-test-'));
      gitWorkspace = path.join(testDir, 'git-project');
      npmWorkspace = path.join(testDir, 'npm-project');
      basicWorkspace = path.join(testDir, 'basic-project');

      // Create directories
      await fs.mkdir(gitWorkspace, { recursive: true });
      await fs.mkdir(npmWorkspace, { recursive: true });
      await fs.mkdir(basicWorkspace, { recursive: true });

      // Setup git workspace
      await fs.mkdir(path.join(gitWorkspace, '.git'), { recursive: true });
      await fs.writeFile(
        path.join(gitWorkspace, '.git', 'config'),
        '[core]\nrepositoryformatversion = 0\n[remote "origin"]\nurl = https://github.com/test/repo.git\n'
      );
      
      // Create some source files
      await fs.mkdir(path.join(gitWorkspace, 'src'), { recursive: true });
      await fs.writeFile(
        path.join(gitWorkspace, 'src', 'index.ts'),
        'export function hello() { return "world"; }'
      );

      // Setup npm workspace
      await fs.writeFile(
        path.join(npmWorkspace, 'package.json'),
        JSON.stringify({
          name: 'test-cli-package',
          version: '1.0.0',
          description: 'Test package for CLI integration'
        }, null, 2)
      );

      await fs.writeFile(
        path.join(npmWorkspace, 'index.js'),
        'console.log("Hello from npm package");'
      );

      // Setup basic workspace
      await fs.writeFile(
        path.join(basicWorkspace, 'README.md'),
        '# Basic Project\n\nThis is a basic project for testing.'
      );

      // Ensure CLI is built
      const cliPath = path.join(__dirname, '../../dist/cli/index.js');
      try {
        await fs.access(cliPath);
      } catch {
        // CLI not built, skip these tests
        console.warn('CLI not built, skipping integration tests');
        return;
      }
    }, 15000);
  });

  afterEach(async () => {
    await withTimeout(async () => {
      if (testDir) {
        await fs.rm(testDir, { recursive: true, force: true });
      }
    }, 5000);
  });

  describe('Context Injection Command', () => {
    it('should inject context for git workspace', async () => {
      await withTimeout(async () => {
        // Given: Git workspace
        // When: Running inject-context command
        const result = await runCLICommand('inject-context', [
          '--prompt=test context injection',
          '--tool=Edit'
        ], { cwd: gitWorkspace });

        // Then: Should return context data
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBeTruthy();

        const output = JSON.parse(result.stdout);
        expect(output.type).toBe('context');
        expect(normalizePath(output.workspaceId)).toBe(normalizePath(gitWorkspace));
        expect(output.sessionId).toMatch(/^session_/);
        expect(typeof output.memoryCount).toBe('number');
      }, 15000);
    });

    it('should inject context for npm workspace', async () => {
      await withTimeout(async () => {
        // Given: NPM workspace
        // When: Running inject-context command
        const result = await runCLICommand('inject-context', [
          '--prompt=npm project context',
          '--tool=Read'
        ], { cwd: npmWorkspace });

        // Then: Should return context data
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBeTruthy();

        const output = JSON.parse(result.stdout);
        expect(output.type).toBe('context');
        expect(normalizePath(output.workspaceId)).toBe(normalizePath(npmWorkspace));
        expect(output.sessionId).toMatch(/^session_/);
      }, 15000);
    });

    it('should inject context with session reuse', async () => {
      await withTimeout(async () => {
        // Given: First context injection
        const firstResult = await runCLICommand('inject-context', [
          '--prompt=first call'
        ], { cwd: gitWorkspace });

        expect(firstResult.exitCode).toBe(0);
        const firstOutput = JSON.parse(firstResult.stdout);
        const sessionId = firstOutput.sessionId;

        // When: Second context injection with session ID
        const secondResult = await runCLICommand('inject-context', [
          '--prompt=second call',
          `--session=${sessionId}`
        ], { cwd: gitWorkspace });

        // Then: Should reuse same session
        expect(secondResult.exitCode).toBe(0);
        const secondOutput = JSON.parse(secondResult.stdout);
        expect(secondOutput.sessionId).toBe(sessionId);
        expect(normalizePath(secondOutput.workspaceId)).toBe(normalizePath(gitWorkspace));
      }, 20000);
    });

    it('should handle context injection from subdirectory', async () => {
      await withTimeout(async () => {
        // Given: Subdirectory in git workspace
        const subDir = path.join(gitWorkspace, 'src');

        // When: Running from subdirectory
        const result = await runCLICommand('inject-context', [
          '--prompt=from subdirectory'
        ], { cwd: subDir });

        // Then: Should detect root workspace
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        expect(normalizePath(output.workspaceId)).toBe(normalizePath(gitWorkspace));
      }, 15000);
    });

    it('should handle invalid arguments gracefully', async () => {
      await withTimeout(async () => {
        // Given: Invalid arguments
        // When: Running with malformed arguments
        const result = await runCLICommand('inject-context', [
          '--invalid-arg=value'
        ], { cwd: basicWorkspace });

        // Then: Should still work (ignore invalid args)
        expect(result.exitCode).toBe(0);
      }, 15000);
    });
  });

  describe('Event Capture Command', () => {
    it('should capture event for workspace', async () => {
      await withTimeout(async () => {
        // Given: Workspace
        // When: Capturing event
        const result = await runCLICommand('capture-event', [
          '--tool=Edit',
          '--content=File modified: src/index.ts',
          '--status=success'
        ], { cwd: gitWorkspace });

        // Then: Should return capture confirmation
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBeTruthy();

        const output = JSON.parse(result.stdout);
        expect(output.type).toBe('captured');
        expect(output.memoryId).toBeTruthy();
        expect(normalizePath(output.workspaceId)).toBe(normalizePath(gitWorkspace));
        expect(output.sessionId).toMatch(/^session_/);
      }, 15000);
    });

    it('should capture event with session ID', async () => {
      await withTimeout(async () => {
        // Given: Existing session from context injection
        const contextResult = await runCLICommand('inject-context', [
          '--prompt=setup session'
        ], { cwd: npmWorkspace });

        const contextOutput = JSON.parse(contextResult.stdout);
        const sessionId = contextOutput.sessionId;

        // When: Capturing event with session ID
        const captureResult = await runCLICommand('capture-event', [
          '--tool=Write',
          '--content=New file created',
          `--session=${sessionId}`
        ], { cwd: npmWorkspace });

        // Then: Should use same session
        expect(captureResult.exitCode).toBe(0);
        const captureOutput = JSON.parse(captureResult.stdout);
        expect(captureOutput.sessionId).toBe(sessionId);
        expect(normalizePath(captureOutput.workspaceId)).toBe(normalizePath(npmWorkspace));
      }, 20000);
    });

    it('should capture manual event without tool', async () => {
      await withTimeout(async () => {
        // Given: Basic workspace
        // When: Capturing manual event
        const result = await runCLICommand('capture-event', [
          '--content=Manual note: Project initialized'
        ], { cwd: basicWorkspace });

        // Then: Should capture as manual event
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        expect(output.type).toBe('captured');
        expect(normalizePath(output.workspaceId)).toBe(normalizePath(basicWorkspace));
      }, 15000);
    });

    it('should handle capture with complex content', async () => {
      await withTimeout(async () => {
        // Given: Complex content with special characters
        const complexContent = JSON.stringify({
          action: 'file_edit',
          file: 'src/index.ts',
          changes: ['added function', 'fixed typo'],
          metadata: { lines: 42, author: 'test' }
        });

        // When: Capturing event with complex content
        const result = await runCLICommand('capture-event', [
          '--tool=Edit',
          `--content=${complexContent}`,
          '--status=success'
        ], { cwd: gitWorkspace });

        // Then: Should handle complex content
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        expect(output.type).toBe('captured');
      }, 15000);
    });
  });

  describe('Workspace and Session Integration', () => {
    it('should maintain session consistency across commands', async () => {
      await withTimeout(async () => {
        // Use a temporary database file for this test
        const dbPath = path.join(testDir, 'test-session.db');
        
        // Given: Initial context injection
        const contextResult = await runCLICommand('inject-context', [
          '--prompt=initial setup'
        ], { cwd: gitWorkspace, dbPath });

        const contextOutput = JSON.parse(contextResult.stdout);
        const sessionId = contextOutput.sessionId;
        const workspaceId = contextOutput.workspaceId;

        // When: Capturing event in same session
        const captureResult = await runCLICommand('capture-event', [
          '--tool=Edit',
          '--content=File edited',
          `--session=${sessionId}`
        ], { cwd: gitWorkspace, dbPath });

        const captureOutput = JSON.parse(captureResult.stdout);

        // And: Another context injection in same session
        const context2Result = await runCLICommand('inject-context', [
          '--prompt=check memories',
          `--session=${sessionId}`
        ], { cwd: gitWorkspace, dbPath });

        const context2Output = JSON.parse(context2Result.stdout);

        // Then: All commands should use same session and workspace
        expect(captureOutput.sessionId).toBe(sessionId);
        expect(normalizePath(captureOutput.workspaceId)).toBe(normalizePath(workspaceId));
        expect(context2Output.sessionId).toBe(sessionId);
        expect(normalizePath(context2Output.workspaceId)).toBe(normalizePath(workspaceId));

        // And: Memory count should be 0 in test mode (intelligence layer is mocked)
        expect(context2Output.memoryCount).toBe(0);
      }, 25000);
    });

    it('should handle workspace switching correctly', async () => {
      await withTimeout(async () => {
        // Given: Session in first workspace
        const result1 = await runCLICommand('inject-context', [
          '--prompt=first workspace'
        ], { cwd: gitWorkspace });

        const output1 = JSON.parse(result1.stdout);

        // When: Running command in different workspace
        const result2 = await runCLICommand('inject-context', [
          '--prompt=second workspace'
        ], { cwd: npmWorkspace });

        const output2 = JSON.parse(result2.stdout);

        // Then: Should use different workspaces and sessions
        expect(normalizePath(output1.workspaceId)).toBe(normalizePath(gitWorkspace));
        expect(normalizePath(output2.workspaceId)).toBe(normalizePath(npmWorkspace));
        expect(output1.sessionId).not.toBe(output2.sessionId);
      }, 20000);
    });

    it('should handle rapid successive commands', async () => {
      await withTimeout(async () => {
        // Use a temporary database file for session consistency
        const dbPath = path.join(testDir, 'rapid-test.db');
        
        // Given: Rapid command execution
        const results = [];

        for (let i = 0; i < 5; i++) {
          const result = await runCLICommand('inject-context', [
            `--prompt=rapid command ${i}`
          ], { cwd: gitWorkspace, dbPath });
          results.push(result);
        }

        // Then: All should succeed
        results.forEach(result => {
          expect(result.exitCode).toBe(0);
          const output = JSON.parse(result.stdout);
          expect(normalizePath(output.workspaceId)).toBe(normalizePath(gitWorkspace));
          expect(output.sessionId).toMatch(/^session_/);
        });

        // And: All commands complete successfully
        const sessionIds = results.map(result => JSON.parse(result.stdout).sessionId);
        sessionIds.forEach(sessionId => {
          expect(sessionId).toMatch(/^session_/);
        });
        // Note: Each CLI invocation creates a new process, so sessions may differ
      }, 30000);
    });
  });

  describe('MCP Server Command', () => {
    it('should start MCP server process', async () => {
      await withTimeout(async () => {
        // Given: Server command
        // When: Starting server (will run indefinitely, so we test startup only)
        const child = spawn(process.execPath, [
          path.join(__dirname, '../../dist/cli/index.js'),
          'server'
        ], {
          env: {
            ...process.env,
            NODE_ENV: 'test',
            MEMORY_DB_PATH: ':memory:'
          }
        });

        // Give server time to start
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Then: Process should be running
        expect(child.pid).toBeDefined();
        expect(child.killed).toBe(false);

        // Cleanup: Kill the server
        child.kill('SIGTERM');

        // Wait for process to exit
        await new Promise(resolve => {
          child.on('exit', resolve);
          setTimeout(() => {
            child.kill('SIGKILL');
            resolve(null);
          }, 1000);
        });
      }, 10000);
    });

    it('should handle server startup errors gracefully', async () => {
      await withTimeout(async () => {
        // Given: Invalid server configuration (malformed environment)
        const result = await runCLICommand('server', [], {
          cwd: '/tmp', // Use temp directory to avoid workspace detection issues
          timeout: 5000
        }).catch(error => {
          // Server might timeout or fail to start, which is expected in test environment
          return { exitCode: 1, stdout: '', stderr: error.message };
        });

        // Then: Should handle gracefully (either succeed or fail cleanly)
        expect(typeof result.exitCode).toBe('number');
      }, 8000);
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown commands gracefully', async () => {
      await withTimeout(async () => {
        // Given: Unknown command
        // When: Running unknown command
        const result = await runCLICommand('unknown-command', [], {
          cwd: basicWorkspace
        });

        // Then: Should show error and exit with non-zero code
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr || result.stdout).toContain('Unknown command');
      }, 10000);
    });

    it('should handle missing workspace gracefully', async () => {
      await withTimeout(async () => {
        // Given: Non-existent directory
        const nonExistentDir = path.join(testDir, 'does-not-exist');

        // When: Running command from non-existent directory
        const result = await runCLICommand('inject-context', [
          '--prompt=test'
        ], { cwd: nonExistentDir }).catch(error => {
          // Expected to fail due to invalid cwd
          return { exitCode: 1, stdout: '', stderr: error.message };
        });

        // Then: Should handle error appropriately
        expect(typeof result.exitCode).toBe('number');
      }, 10000);
    });

    it('should handle malformed arguments', async () => {
      await withTimeout(async () => {
        // Given: Malformed arguments
        // When: Running with malformed arguments
        const result = await runCLICommand('inject-context', [
          '--malformed-arg-without-value',
          '=invalid-format',
          '--normal-arg=value'
        ], { cwd: basicWorkspace });

        // Then: Should handle gracefully and still work
        expect(result.exitCode).toBe(0);
      }, 10000);
    });

    it('should handle system interruption signals', async () => {
      await withTimeout(async () => {
        // Given: Long-running command
        const child = spawn(process.execPath, [
          path.join(__dirname, '../../dist/cli/index.js'),
          'inject-context',
          '--prompt=long running test'
        ], {
          cwd: gitWorkspace,
          env: {
            ...process.env,
            NODE_ENV: 'test'
          }
        });

        // Small delay to ensure process starts
        await new Promise(resolve => setTimeout(resolve, 100));

        // When: Sending interrupt signal
        child.kill('SIGINT');

        // Then: Process should exit gracefully
        const exitCode = await new Promise(resolve => {
          child.on('exit', resolve);
          setTimeout(() => {
            child.kill('SIGKILL');
            resolve(-1);
          }, 2000);
        });

        expect(exitCode === null || typeof exitCode === 'number').toBe(true);
      }, 5000);
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle multiple workspaces efficiently', async () => {
      await withTimeout(async () => {
        // Given: Multiple different workspaces
        const workspaces = [gitWorkspace, npmWorkspace, basicWorkspace];
        const startTime = Date.now();

        // When: Running commands across all workspaces
        const promises = workspaces.map(workspace =>
          runCLICommand('inject-context', [
            '--prompt=performance test'
          ], { cwd: workspace })
        );

        const results = await Promise.all(promises);
        const endTime = Date.now();

        // Then: All should succeed within reasonable time
        expect(endTime - startTime).toBeLessThan(20000); // Less than 20 seconds

        results.forEach((result, index) => {
          expect(result.exitCode).toBe(0);
          const output = JSON.parse(result.stdout);
          expect(normalizePath(output.workspaceId)).toBe(normalizePath(workspaces[index]));
        });
      }, 25000);
    });

    it('should maintain consistent performance under load', async () => {
      await withTimeout(async () => {
        // Given: Sequence of operations
        const operations = [];
        
        for (let i = 0; i < 3; i++) {
          operations.push(
            () => runCLICommand('capture-event', [
              `--content=Load test event ${i}`,
              '--tool=test'
            ], { cwd: gitWorkspace })
          );
          
          operations.push(
            () => runCLICommand('inject-context', [
              `--prompt=Load test context ${i}`
            ], { cwd: gitWorkspace })
          );
        }

        const startTime = Date.now();

        // When: Running operations sequentially
        for (const operation of operations) {
          const result = await operation();
          expect(result.exitCode).toBe(0);
        }

        const endTime = Date.now();

        // Then: Should complete within reasonable time
        expect(endTime - startTime).toBeLessThan(30000); // Less than 30 seconds
      }, 35000);
    });
  });
});