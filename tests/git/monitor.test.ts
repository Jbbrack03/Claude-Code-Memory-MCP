import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { GitMonitor } from "../../src/git/monitor.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";

const execAsync = promisify(exec);

describe('GitMonitor', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Create temporary directory for each test
    testDir = await mkdtemp(path.join(tmpdir(), 'git-monitor-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(async () => {
    // Restore original directory
    process.chdir(originalCwd);
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('repository detection', () => {
    it('should detect git repository', async () => {
      // Given: A git repository
      await execAsync('git init');
      
      // When: Monitor initializes
      const monitor = new GitMonitor({ autoDetect: true });
      await monitor.initialize();
      
      // Then: Repository is detected
      expect(monitor.isGitRepository()).toBe(true);
      expect(monitor.getRepositoryRoot()).toBe(process.cwd());
    });

    it('should handle non-git directories', async () => {
      // Given: Not a git repository
      const monitor = new GitMonitor({ autoDetect: true });
      
      // When: Initializing in non-git directory
      await monitor.initialize();
      
      // Then: Gracefully handles absence
      expect(monitor.isGitRepository()).toBe(false);
      expect(monitor.getState()).toEqual({
        initialized: false,
        isDirty: false,
        reason: 'Not a git repository'
      });
    });
  });

  describe('state tracking', () => {
    it('should track current branch', async () => {
      // Given: Repository on main branch
      await execAsync('git init && git checkout -b main');
      
      // When: Getting state
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const state = await monitor.getCurrentState();
      
      // Then: Branch is tracked
      expect(state.currentBranch).toBe('main');
    });

    it('should track dirty state', async () => {
      // Given: Repository with uncommitted changes
      await execAsync('git init');
      await fs.writeFile('test.txt', 'content');
      
      // When: Getting state
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const state = await monitor.getCurrentState();
      
      // Then: Dirty state is detected
      expect(state.isDirty).toBe(true);
      expect(state.changes).toContainEqual({
        file: 'test.txt',
        status: 'untracked'
      });
    });

    it('should detect branch switches', async () => {
      // Given: Monitor watching repository
      await execAsync('git init && git checkout -b main');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('test.txt', 'initial');
      await execAsync('git add test.txt && git commit -m "Initial commit"');
      
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const onChange = jest.fn();
      monitor.on('branchChange', onChange);
      
      // When: Branch changes
      await execAsync('git checkout -b feature');
      await monitor.checkForChanges();
      
      // Then: Change is detected
      expect(onChange).toHaveBeenCalledWith({
        from: 'main',
        to: 'feature'
      });
    });

    it('should handle detached HEAD state', async () => {
      // Given: Repository with a commit
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('test.txt', 'content');
      await execAsync('git add test.txt && git commit -m "First commit"');
      const { stdout } = await execAsync('git rev-parse HEAD');
      const commit = stdout.trim();
      
      // When: Checking out specific commit (detached HEAD)
      await execAsync(`git checkout ${commit}`);
      
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const state = await monitor.getCurrentState();
      
      // Then: Detached state is handled
      expect(state.currentBranch).toBe('HEAD');
      expect(state.detached).toBe(true);
      expect(state.currentCommit).toBe(commit);
    });

    it('should track current commit hash', async () => {
      // Given: Repository with a commit
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('test.txt', 'content');
      await execAsync('git add test.txt && git commit -m "Test commit"');
      
      // When: Getting state
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const state = await monitor.getCurrentState();
      
      // Then: Commit hash is tracked
      expect(state.currentCommit).toMatch(/^[a-f0-9]{40}$/);
    });

    it('should handle empty repository', async () => {
      // Given: Empty git repository
      await execAsync('git init');
      
      // When: Getting state
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const state = await monitor.getCurrentState();
      
      // Then: Empty state is handled
      expect(state.initialized).toBe(true);
      expect(state.currentBranch).toMatch(/^(main|master)$/);
      expect(state.currentCommit).toBeUndefined();
      expect(state.isDirty).toBe(false);
    });
  });

  describe('file change detection', () => {
    it('should detect modified files', async () => {
      // Given: Repository with committed file
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      // Create and commit initial file
      await fs.writeFile('initial.txt', 'initial content');
      await execAsync('git add initial.txt && git commit -m "Initial commit"');
      // Now create the file we'll test
      await fs.writeFile('file.js', 'original content');
      await execAsync('git add file.js && git commit -m "Add file"');
      
      // When: File is modified (but not staged)
      await fs.writeFile('file.js', 'modified content');
      
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const state = await monitor.getCurrentState();
      
      // Then: Modification is detected
      expect(state.isDirty).toBe(true);
      expect(state.changes).toContainEqual({
        file: 'file.js',
        status: 'modified'
      });
    });

    it('should detect staged files', async () => {
      // Given: Repository with staged changes
      await execAsync('git init');
      await fs.writeFile('new.js', 'new file');
      await execAsync('git add new.js');
      
      // When: Getting state
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const state = await monitor.getCurrentState();
      
      // Then: Staged files are detected
      expect(state.isDirty).toBe(true);
      expect(state.changes).toContainEqual({
        file: 'new.js',
        status: 'staged'
      });
    });

    it('should detect deleted files', async () => {
      // Given: Repository with deleted file
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('toDelete.js', 'content');
      await execAsync('git add toDelete.js && git commit -m "Add file"');
      await fs.unlink('toDelete.js');
      
      // When: Getting state
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const state = await monitor.getCurrentState();
      
      // Then: Deletion is detected
      expect(state.isDirty).toBe(true);
      expect(state.changes).toContainEqual({
        file: 'toDelete.js',
        status: 'deleted'
      });
    });
  });

  describe('error handling', () => {
    it('should handle git command failures gracefully', async () => {
      // Given: Monitor in non-git directory
      const monitor = new GitMonitor({});
      await monitor.initialize();
      
      // When: Attempting to get state
      const state = await monitor.getState();
      
      // Then: Returns safe default state
      expect(state.initialized).toBe(false);
      expect(state.reason).toBe('Not a git repository');
    });

    it('should handle permission errors', async () => {
      // Given: Repository with restricted permissions
      await execAsync('git init');
      await fs.chmod('.git', 0o000);
      
      // When: Attempting to initialize
      const monitor = new GitMonitor({});
      const initPromise = monitor.initialize();
      
      // Then: Handles permission error gracefully
      await expect(initPromise).resolves.not.toThrow();
      expect(monitor.isGitRepository()).toBe(false);
      
      // Cleanup: Restore permissions
      await fs.chmod('.git', 0o755);
    });
  });
});