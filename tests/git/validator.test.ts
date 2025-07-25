import { GitValidator } from "../../src/git/validator.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import type { Memory } from "../../src/storage/engine.js";

const execAsync = promisify(exec);

describe('GitValidator', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Create temporary directory for each test
    testDir = await mkdtemp(path.join(tmpdir(), 'git-validator-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(async () => {
    // Restore original directory
    process.chdir(originalCwd);
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('file validation', () => {
    it('should validate file existence in git', async () => {
      // Given: File tracked in git
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('tracked.js', 'content');
      await execAsync('git add tracked.js && git commit -m "Add file"');
      const { stdout } = await execAsync('git rev-parse HEAD');
      const commitHash = stdout.trim();
      
      // When: Validating memory
      const validator = new GitValidator();
      const memory: Partial<Memory> = {
        id: 'mem1',
        eventType: 'file_write',
        metadata: { file: 'tracked.js' },
        gitCommit: commitHash
      };
      const result = await validator.validateMemory(memory as Memory);
      
      // Then: Memory is valid
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect file content mismatches', async () => {
      // Given: File content changed after memory
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('file.js', 'original');
      await execAsync('git add file.js && git commit -m "Original"');
      const { stdout } = await execAsync('git rev-parse HEAD');
      const commit = stdout.trim();
      
      // Memory captured
      const memory: Partial<Memory> = {
        id: 'mem1',
        eventType: 'file_read',
        content: 'original content',
        metadata: { file: 'file.js' },
        gitCommit: commit
      };
      
      // File changed
      await fs.writeFile('file.js', 'modified');
      await execAsync('git add file.js && git commit -m "Modified"');
      
      // When: Validating old memory
      const validator = new GitValidator();
      const result = await validator.validateMemory(memory as Memory);
      
      // Then: Mismatch is detected
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('File content mismatch');
    });

    it('should validate branch availability', async () => {
      // Given: Initialize repo
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('test.txt', 'content');
      await execAsync('git add test.txt && git commit -m "Initial"');
      
      // Memory from deleted branch
      const memory: Partial<Memory> = {
        id: 'mem1',
        gitBranch: 'deleted-feature',
        gitCommit: 'abc123'
      };
      
      // When: Validating
      const validator = new GitValidator();
      const result = await validator.validateMemory(memory as Memory);
      
      // Then: Branch absence is detected
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Branch not found: deleted-feature');
    });

    it('should validate commit existence', async () => {
      // Given: Repository with some commits
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('file.txt', 'content');
      await execAsync('git add file.txt && git commit -m "Test"');
      
      // When: Validating with non-existent commit
      const memory: Partial<Memory> = {
        id: 'mem1',
        gitCommit: '0000000000000000000000000000000000000000'
      };
      
      const validator = new GitValidator();
      const result = await validator.validateMemory(memory as Memory);
      
      // Then: Invalid commit is detected
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Commit not found: 0000000000000000000000000000000000000000');
    });

    it('should handle missing file references', async () => {
      // Given: Repository with a file
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('exists.js', 'content');
      await execAsync('git add exists.js && git commit -m "Add file"');
      const { stdout } = await execAsync('git rev-parse HEAD');
      const commit = stdout.trim();
      
      // When: Validating memory referencing non-existent file
      const memory: Partial<Memory> = {
        id: 'mem1',
        eventType: 'file_write',
        metadata: { file: 'missing.js' },
        gitCommit: commit
      };
      
      const validator = new GitValidator();
      const result = await validator.validateMemory(memory as Memory);
      
      // Then: Missing file is detected
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('File not found in commit: missing.js');
    });

    it('should validate multiple issues', async () => {
      // Given: Repository
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('test.txt', 'content');
      await execAsync('git add test.txt && git commit -m "Initial"');
      
      // When: Memory with multiple issues
      const memory: Partial<Memory> = {
        id: 'mem1',
        eventType: 'file_write',
        metadata: { file: 'nonexistent.js' },
        gitBranch: 'nonexistent-branch',
        gitCommit: 'invalid-commit-hash'
      };
      
      const validator = new GitValidator();
      const result = await validator.validateMemory(memory as Memory);
      
      // Then: All issues are detected
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('workspace validation', () => {
    it('should validate workspace path matches repository', async () => {
      // Given: Repository in specific location
      await execAsync('git init');
      const repoPath = process.cwd();
      
      // When: Validating memory with matching workspace
      const memory: Partial<Memory> = {
        id: 'mem1',
        workspaceId: repoPath
      };
      
      const validator = new GitValidator({ workspacePath: repoPath });
      const result = await validator.validateMemory(memory as Memory);
      
      // Then: Workspace is valid
      expect(result.valid).toBe(true);
    });

    it('should detect workspace mismatches', async () => {
      // Given: Repository
      await execAsync('git init');
      
      // When: Validating memory from different workspace
      const memory: Partial<Memory> = {
        id: 'mem1',
        workspaceId: '/different/workspace'
      };
      
      const validator = new GitValidator({ workspacePath: process.cwd() });
      const result = await validator.validateMemory(memory as Memory);
      
      // Then: Mismatch is detected
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Workspace mismatch');
    });
  });

  describe('batch validation', () => {
    it('should validate multiple memories efficiently', async () => {
      // Given: Repository with files
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('file1.js', 'content1');
      await fs.writeFile('file2.js', 'content2');
      await execAsync('git add . && git commit -m "Add files"');
      const { stdout } = await execAsync('git rev-parse HEAD');
      const commit = stdout.trim();
      
      // When: Validating multiple memories
      const memories: Partial<Memory>[] = [
        {
          id: 'mem1',
          eventType: 'file_write',
          metadata: { file: 'file1.js' },
          gitCommit: commit
        },
        {
          id: 'mem2',
          eventType: 'file_write',
          metadata: { file: 'file2.js' },
          gitCommit: commit
        },
        {
          id: 'mem3',
          eventType: 'file_write',
          metadata: { file: 'missing.js' },
          gitCommit: commit
        }
      ];
      
      const validator = new GitValidator();
      const results = await validator.validateMemories(memories as Memory[]);
      
      // Then: Each memory is validated
      expect(results).toHaveLength(3);
      expect(results[0]?.valid).toBe(true);
      expect(results[1]?.valid).toBe(true);
      expect(results[2]?.valid).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle non-git directories gracefully', async () => {
      // Given: Not a git repository
      const memory: Partial<Memory> = {
        id: 'mem1',
        gitCommit: 'abc123'
      };
      
      // When: Attempting validation
      const validator = new GitValidator();
      const result = await validator.validateMemory(memory as Memory);
      
      // Then: Handles gracefully
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Not a git repository');
    });

    it('should handle git command failures', async () => {
      // Given: Repository with restricted permissions
      await execAsync('git init');
      await fs.chmod('.git', 0o000);
      
      const memory: Partial<Memory> = {
        id: 'mem1',
        gitCommit: 'abc123'
      };
      
      // When: Attempting validation
      const validator = new GitValidator();
      const result = await validator.validateMemory(memory as Memory);
      
      // Then: Handles error gracefully
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      
      // Cleanup: Restore permissions
      await fs.chmod('.git', 0o755);
    });
  });
});