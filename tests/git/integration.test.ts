import { GitIntegration } from "../../src/git/integration.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import type { Config } from "../../src/config/index.js";

const execAsync = promisify(exec);

describe('GitIntegration', () => {
  let testDir: string;
  let originalCwd: string;
  let gitConfig: Config["git"];

  beforeEach(async () => {
    // Create temporary directory for each test
    testDir = await mkdtemp(path.join(tmpdir(), 'git-integration-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Default git config
    gitConfig = {
      enabled: true,
      autoDetect: true,
      remote: "origin",
      validation: {
        checkInterval: 1000,
        validateOnStartup: true,
        reconcileOnConflict: true
      }
    };
  });

  afterEach(async () => {
    // Restore original directory
    process.chdir(originalCwd);
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('should initialize in git repository', async () => {
      // Given: A git repository
      await execAsync('git init');
      
      // When: Initializing
      const integration = new GitIntegration(gitConfig);
      await integration.initialize();
      
      // Then: Should be initialized
      const state = await integration.getCurrentState();
      expect(state.initialized).toBe(true);
    });

    it('should handle non-git directories', async () => {
      // Given: Not a git repository
      // When: Initializing
      const integration = new GitIntegration(gitConfig);
      await integration.initialize();
      
      // Then: Should handle gracefully
      const state = await integration.getCurrentState();
      expect(state.initialized).toBe(false);
    });

    it('should respect disabled config', async () => {
      // Given: Git integration disabled
      gitConfig.enabled = false;
      
      // When: Initializing
      const integration = new GitIntegration(gitConfig);
      await integration.initialize();
      
      // Then: Should not initialize
      const state = await integration.getCurrentState();
      expect(state.initialized).toBe(false);
    });
  });

  describe('state tracking', () => {
    it('should track current git state', async () => {
      // Given: Repository with commits
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('test.txt', 'content');
      await execAsync('git add test.txt && git commit -m "Initial commit"');
      
      // When: Getting state
      const integration = new GitIntegration(gitConfig);
      await integration.initialize();
      const state = await integration.getCurrentState();
      
      // Then: State should be tracked
      expect(state.initialized).toBe(true);
      expect(state.currentBranch).toMatch(/^(main|master)$/);
      expect(state.currentCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(state.isDirty).toBe(false);
    });

    it('should track dirty state', async () => {
      // Given: Repository with uncommitted changes
      await execAsync('git init');
      await fs.writeFile('new.txt', 'content');
      
      // When: Getting state
      const integration = new GitIntegration(gitConfig);
      await integration.initialize();
      const state = await integration.getCurrentState();
      
      // Then: Should show dirty
      expect(state.isDirty).toBe(true);
    });
  });

  describe('memory validation', () => {
    it('should validate memory against git state', async () => {
      // Given: Repository with a file
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('tracked.js', 'content');
      await execAsync('git add tracked.js && git commit -m "Add file"');
      const { stdout } = await execAsync('git rev-parse HEAD');
      const commit = stdout.trim();
      
      // When: Validating memory
      const integration = new GitIntegration(gitConfig);
      await integration.initialize();
      
      const memory = {
        id: 'mem1',
        eventType: 'file_write',
        content: 'content',
        metadata: { file: 'tracked.js' },
        timestamp: new Date(),
        sessionId: 'test',
        gitCommit: commit
      };
      
      const isValid = await integration.validateMemory(memory);
      
      // Then: Should be valid
      expect(isValid).toBe(true);
    });

    it('should reject invalid memories', async () => {
      // Given: Repository
      await execAsync('git init');
      
      // When: Validating memory with invalid commit
      const integration = new GitIntegration(gitConfig);
      await integration.initialize();
      
      const memory = {
        id: 'mem1',
        eventType: 'file_write',
        content: 'content',
        metadata: { file: 'nonexistent.js' },
        timestamp: new Date(),
        sessionId: 'test',
        gitCommit: 'invalid-commit'
      };
      
      const isValid = await integration.validateMemory(memory);
      
      // Then: Should be invalid
      expect(isValid).toBe(false);
    });
  });

  describe('event monitoring', () => {
    it('should monitor branch changes', async () => {
      // Given: Repository with multiple branches
      await execAsync('git init');
      await execAsync('git config user.email "test@example.com" && git config user.name "Test User"');
      await fs.writeFile('test.txt', 'content');
      await execAsync('git add test.txt && git commit -m "Initial"');
      
      const integration = new GitIntegration(gitConfig);
      await integration.initialize();
      
      // Set up branch change listener
      const originalState = await integration.getCurrentState();
      
      // When: Creating and switching to new branch
      await execAsync('git checkout -b feature');
      
      // Give monitor time to detect change
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const newState = await integration.getCurrentState();
      
      // Then: Branch change should be detected
      expect(originalState.currentBranch).not.toBe(newState.currentBranch);
      expect(newState.currentBranch).toBe('feature');
    });
  });

  describe('lifecycle management', () => {
    it('should properly close resources', async () => {
      // Given: Initialized integration
      await execAsync('git init');
      const integration = new GitIntegration(gitConfig);
      await integration.initialize();
      
      // When: Closing
      await integration.close();
      
      // Then: State should reflect closed status
      const state = await integration.getCurrentState();
      expect(state.initialized).toBe(false);
    });
  });
});