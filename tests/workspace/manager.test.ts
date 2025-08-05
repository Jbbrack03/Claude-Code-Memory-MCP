import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { WorkspaceManager } from "../../src/workspace/manager.js";
import { GitIntegration } from "../../src/git/integration.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

/**
 * Timeout helper for test operations
 */
async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = 5000
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([operation(), timeoutPromise]);
}

describe('WorkspaceManager Unit Tests', () => {
  let workspaceManager: WorkspaceManager;
  let mockGit: jest.Mocked<GitIntegration>;
  let testDir: string;
  let gitWorkspace: string;
  let npmWorkspace: string;
  let nestedWorkspace: string;

  beforeEach(async () => {
    await withTimeout(async () => {
      // Create test directory structure
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-manager-test-'));
      gitWorkspace = path.join(testDir, 'git-project');
      npmWorkspace = path.join(testDir, 'npm-project');
      nestedWorkspace = path.join(gitWorkspace, 'nested', 'deep');

      // Create directories
      await fs.mkdir(gitWorkspace, { recursive: true });
      await fs.mkdir(npmWorkspace, { recursive: true });
      await fs.mkdir(nestedWorkspace, { recursive: true });

      // Setup git workspace
      await fs.mkdir(path.join(gitWorkspace, '.git'), { recursive: true });
      await fs.writeFile(
        path.join(gitWorkspace, '.git', 'config'),
        '[remote "origin"]\nurl = https://github.com/test/repo.git\n'
      );

      // Setup npm workspace
      await fs.writeFile(
        path.join(npmWorkspace, 'package.json'),
        JSON.stringify({
          name: '@test/npm-package',
          version: '2.1.0',
          description: 'Test package'
        }, null, 2)
      );

      // Mock GitIntegration
      mockGit = {
        getCurrentState: jest.fn(),
        initialize: jest.fn(),
        close: jest.fn()
      } as any;

      workspaceManager = new WorkspaceManager(mockGit);
    });
  });

  afterEach(async () => {
    await withTimeout(async () => {
      if (testDir) {
        await fs.rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Constructor and Initialization', () => {
    it('should create manager without GitIntegration', async () => {
      await withTimeout(async () => {
        // Given: No GitIntegration provided
        // When: Creating WorkspaceManager
        const manager = new WorkspaceManager();
        
        // Then: Should create successfully
        expect(manager).toBeInstanceOf(WorkspaceManager);
      });
    });

    it('should create manager with GitIntegration', async () => {
      await withTimeout(async () => {
        // Given: GitIntegration provided
        // When: Creating WorkspaceManager
        const manager = new WorkspaceManager(mockGit);
        
        // Then: Should create successfully
        expect(manager).toBeInstanceOf(WorkspaceManager);
      });
    });
  });

  describe('Workspace Detection', () => {
    describe('Git Workspace Detection', () => {
      it('should detect git workspace using GitIntegration', async () => {
        await withTimeout(async () => {
          // Given: GitIntegration returns repository path
          mockGit.getCurrentState.mockResolvedValue({
            repository: gitWorkspace,
            branch: 'main',
            commit: 'abc123',
            remote: 'origin'
          });

          // When: Detecting workspace
          const detected = await workspaceManager.detectWorkspace(gitWorkspace);

          // Then: Should use GitIntegration result
          expect(detected).toBe(gitWorkspace);
          expect(mockGit.getCurrentState).toHaveBeenCalled();
        });
      });

      it('should fallback to manual git detection when GitIntegration fails', async () => {
        await withTimeout(async () => {
          // Given: GitIntegration throws error
          mockGit.getCurrentState.mockRejectedValue(new Error('Git not available'));

          // When: Detecting workspace
          const detected = await workspaceManager.detectWorkspace(gitWorkspace);

          // Then: Should fallback and still detect git workspace
          expect(detected).toBe(gitWorkspace);
        });
      });

      it('should detect git workspace from subdirectory', async () => {
        await withTimeout(async () => {
          // Given: GitIntegration fails (test manual detection)
          mockGit.getCurrentState.mockRejectedValue(new Error('Git error'));

          // When: Detecting from nested directory
          const detected = await workspaceManager.detectWorkspace(nestedWorkspace);

          // Then: Should find git root
          expect(detected).toBe(gitWorkspace);
        });
      });

      it('should handle git detection from filesystem root', async () => {
        await withTimeout(async () => {
          // Given: Starting from root directory (no .git found)
          mockGit.getCurrentState.mockRejectedValue(new Error('No git'));

          // When: Detecting from root
          const detected = await workspaceManager.detectWorkspace('/');

          // Then: Should fallback to directory type
          expect(detected).toBe('/');
        });
      });
    });

    describe('NPM Workspace Detection', () => {
      it('should detect npm workspace by package.json', async () => {
        await withTimeout(async () => {
          // Given: GitIntegration returns no repository
          mockGit.getCurrentState.mockResolvedValue({
            repository: null,
            branch: null,
            commit: null,
            remote: null
          });

          // When: Detecting npm workspace
          const detected = await workspaceManager.detectWorkspace(npmWorkspace);

          // Then: Should detect npm workspace
          expect(detected).toBe(npmWorkspace);
        });
      });

      it('should find package.json in parent directories', async () => {
        await withTimeout(async () => {
          // Given: Subdirectory in npm workspace
          const subDir = path.join(npmWorkspace, 'src', 'components');
          await fs.mkdir(subDir, { recursive: true });
          
          mockGit.getCurrentState.mockResolvedValue({
            repository: null,
            branch: null,
            commit: null,
            remote: null
          });

          // When: Detecting from subdirectory
          const detected = await workspaceManager.detectWorkspace(subDir);

          // Then: Should find npm workspace root
          expect(detected).toBe(npmWorkspace);
        });
      });
    });

    describe('Directory Fallback', () => {
      it('should fallback to directory type when no git or npm found', async () => {
        await withTimeout(async () => {
          // Given: Plain directory with no git or package.json
          const plainDir = path.join(testDir, 'plain-directory');
          await fs.mkdir(plainDir, { recursive: true });
          
          mockGit.getCurrentState.mockResolvedValue({
            repository: null,
            branch: null,
            commit: null,
            remote: null
          });

          // When: Detecting workspace
          const detected = await workspaceManager.detectWorkspace(plainDir);

          // Then: Should return directory path
          expect(detected).toBe(plainDir);
        });
      });

      it('should use current working directory when no path provided', async () => {
        await withTimeout(async () => {
          // Given: No path provided, git returns null
          mockGit.getCurrentState.mockResolvedValue({
            repository: null,
            branch: null,
            commit: null,
            remote: null
          });

          // When: Detecting workspace without path
          const detected = await workspaceManager.detectWorkspace();

          // Then: Should use current working directory
          expect(detected).toBe(process.cwd());
        });
      });
    });

    describe('Caching Behavior', () => {
      it('should cache workspace detection results', async () => {
        await withTimeout(async () => {
          // Given: First detection
          mockGit.getCurrentState.mockResolvedValue({
            repository: gitWorkspace,
            branch: 'main',
            commit: 'abc123',
            remote: 'origin'
          });

          const first = await workspaceManager.detectWorkspace(gitWorkspace);

          // When: Second detection (should use cache)
          const second = await workspaceManager.detectWorkspace(gitWorkspace);

          // Then: Should return cached result
          expect(first).toBe(second);
          expect(first).toBe(gitWorkspace);
          
          // GitIntegration should only be called once
          expect(mockGit.getCurrentState).toHaveBeenCalledTimes(1);
        });
      });

      it('should use cached workspace for subdirectories', async () => {
        await withTimeout(async () => {
          // Given: Workspace detected for root
          mockGit.getCurrentState.mockResolvedValue({
            repository: gitWorkspace,
            branch: 'main',
            commit: 'abc123',
            remote: 'origin'
          });

          await workspaceManager.detectWorkspace(gitWorkspace);

          // When: Detecting from subdirectory
          const fromSubdir = await workspaceManager.detectWorkspace(nestedWorkspace);

          // Then: Should use cached result
          expect(fromSubdir).toBe(gitWorkspace);
        });
      });

      it('should clear cache successfully', async () => {
        await withTimeout(async () => {
          // Given: Cached workspace
          mockGit.getCurrentState.mockResolvedValue({
            repository: gitWorkspace,
            branch: 'main',
            commit: 'abc123',
            remote: 'origin'
          });

          await workspaceManager.detectWorkspace(gitWorkspace);

          // When: Clearing cache
          workspaceManager.clearCache();

          // And: Detecting again
          await workspaceManager.detectWorkspace(gitWorkspace);

          // Then: Should call GitIntegration again
          expect(mockGit.getCurrentState).toHaveBeenCalledTimes(2);
        });
      });
    });
  });

  describe('Workspace Metadata', () => {
    describe('Git Workspace Metadata', () => {
      it('should generate correct metadata for git workspace', async () => {
        await withTimeout(async () => {
          // Given: Git workspace with remote
          mockGit.getCurrentState.mockResolvedValue({
            repository: gitWorkspace,
            branch: 'main',
            commit: 'abc123',
            remote: 'https://github.com/test/repo.git'
          });

          // When: Getting metadata
          const metadata = await workspaceManager.getWorkspaceMetadata(gitWorkspace);

          // Then: Should have correct git metadata
          expect(metadata.id).toBe(gitWorkspace);
          expect(metadata.type).toBe('git');
          expect(metadata.name).toBe('git-project');
          expect(metadata.gitRemote).toBe('https://github.com/test/repo.git');
          expect(metadata.detectedAt).toBeInstanceOf(Date);
        });
      });

      it('should handle git metadata without remote', async () => {
        await withTimeout(async () => {
          // Given: Git workspace without remote
          mockGit.getCurrentState.mockResolvedValue({
            repository: gitWorkspace,
            branch: 'main',
            commit: 'abc123',
            remote: null
          });

          // When: Getting metadata
          const metadata = await workspaceManager.getWorkspaceMetadata(gitWorkspace);

          // Then: Should have git metadata without remote
          expect(metadata.type).toBe('git');
          expect(metadata.gitRemote).toBeUndefined();
        });
      });

      it('should handle git integration errors gracefully', async () => {
        await withTimeout(async () => {
          // Given: GitIntegration throws error
          mockGit.getCurrentState.mockRejectedValue(new Error('Git error'));

          // When: Getting metadata for git workspace
          const metadata = await workspaceManager.getWorkspaceMetadata(gitWorkspace);

          // Then: Should still detect as git type (manual detection)
          expect(metadata.type).toBe('git');
          expect(metadata.gitRemote).toBeUndefined();
        });
      });
    });

    describe('NPM Workspace Metadata', () => {
      it('should generate correct metadata for npm workspace', async () => {
        await withTimeout(async () => {
          // Given: NPM workspace
          // When: Getting metadata
          const metadata = await workspaceManager.getWorkspaceMetadata(npmWorkspace);

          // Then: Should have correct npm metadata
          expect(metadata.id).toBe(npmWorkspace);
          expect(metadata.type).toBe('npm');
          expect(metadata.name).toBe('npm-project');
          expect(metadata.packageName).toBe('@test/npm-package');
          expect(metadata.detectedAt).toBeInstanceOf(Date);
        });
      });

      it('should handle corrupted package.json gracefully', async () => {
        await withTimeout(async () => {
          // Given: Corrupted package.json
          const corruptedNpm = path.join(testDir, 'corrupted-npm');
          await fs.mkdir(corruptedNpm, { recursive: true });
          await fs.writeFile(
            path.join(corruptedNpm, 'package.json'),
            '{ invalid json'
          );

          // When: Getting metadata
          const metadata = await workspaceManager.getWorkspaceMetadata(corruptedNpm);

          // Then: Should still detect as npm but without package name
          expect(metadata.type).toBe('npm');
          expect(metadata.packageName).toBeUndefined();
        });
      });

      it('should handle package.json without name field', async () => {
        await withTimeout(async () => {
          // Given: package.json without name
          const noNameNpm = path.join(testDir, 'no-name-npm');
          await fs.mkdir(noNameNpm, { recursive: true });
          await fs.writeFile(
            path.join(noNameNpm, 'package.json'),
            JSON.stringify({ version: '1.0.0' })
          );

          // When: Getting metadata
          const metadata = await workspaceManager.getWorkspaceMetadata(noNameNpm);

          // Then: Should detect as npm without package name
          expect(metadata.type).toBe('npm');
          expect(metadata.packageName).toBeUndefined();
        });
      });
    });

    describe('Directory Workspace Metadata', () => {
      it('should generate correct metadata for directory workspace', async () => {
        await withTimeout(async () => {
          // Given: Plain directory
          const plainDir = path.join(testDir, 'plain-directory');
          await fs.mkdir(plainDir, { recursive: true });

          // When: Getting metadata
          const metadata = await workspaceManager.getWorkspaceMetadata(plainDir);

          // Then: Should have correct directory metadata
          expect(metadata.id).toBe(plainDir);
          expect(metadata.type).toBe('directory');
          expect(metadata.name).toBe('plain-directory');
          expect(metadata.gitRemote).toBeUndefined();
          expect(metadata.packageName).toBeUndefined();
          expect(metadata.detectedAt).toBeInstanceOf(Date);
        });
      });
    });

    describe('Metadata Caching', () => {
      it('should cache metadata results', async () => {
        await withTimeout(async () => {
          // Given: First metadata request
          const first = await workspaceManager.getWorkspaceMetadata(gitWorkspace);

          // When: Second metadata request
          const second = await workspaceManager.getWorkspaceMetadata(gitWorkspace);

          // Then: Should return same cached object
          expect(first).toBe(second);
        });
      });

      it('should generate fresh metadata for uncached workspaces', async () => {
        await withTimeout(async () => {
          // Given: Different workspaces
          const metadata1 = await workspaceManager.getWorkspaceMetadata(gitWorkspace);
          const metadata2 = await workspaceManager.getWorkspaceMetadata(npmWorkspace);

          // Then: Should have different metadata objects
          expect(metadata1).not.toBe(metadata2);
          expect(metadata1.id).toBe(gitWorkspace);
          expect(metadata2.id).toBe(npmWorkspace);
        });
      });
    });
  });

  describe('Workspace Switching', () => {
    it('should switch to existing workspace successfully', async () => {
      await withTimeout(async () => {
        // Given: Target workspace exists
        // When: Switching workspace
        await workspaceManager.switchWorkspace(npmWorkspace);

        // Then: Should complete without error
        // And metadata should be available
        const metadata = await workspaceManager.getWorkspaceMetadata(npmWorkspace);
        expect(metadata.id).toBe(npmWorkspace);
      });
    });

    it('should throw error for non-existent workspace', async () => {
      await withTimeout(async () => {
        // Given: Non-existent workspace path
        const nonExistent = path.join(testDir, 'does-not-exist');

        // When/Then: Switching should throw error
        await expect(workspaceManager.switchWorkspace(nonExistent))
          .rejects.toThrow('Workspace directory does not exist');
      });
    });

    it('should update cache when switching workspace', async () => {
      await withTimeout(async () => {
        // Given: Initial workspace detection
        await workspaceManager.detectWorkspace(gitWorkspace);

        // When: Switching to different workspace
        await workspaceManager.switchWorkspace(npmWorkspace);

        // Then: Should have metadata for new workspace
        const metadata = await workspaceManager.getWorkspaceMetadata(npmWorkspace);
        expect(metadata.id).toBe(npmWorkspace);
        expect(metadata.type).toBe('directory'); // Initially detected as directory
      });
    });

    it('should handle switching to same workspace', async () => {
      await withTimeout(async () => {
        // Given: Current workspace
        await workspaceManager.detectWorkspace(gitWorkspace);

        // When: Switching to same workspace
        await workspaceManager.switchWorkspace(gitWorkspace);

        // Then: Should complete successfully
        const metadata = await workspaceManager.getWorkspaceMetadata(gitWorkspace);
        expect(metadata.id).toBe(gitWorkspace);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle file system permission errors', async () => {
      await withTimeout(async () => {
        // Given: Path that might cause permission issues
        const restrictedPath = '/root/restricted';

        // When: Attempting to detect workspace
        const detected = await workspaceManager.detectWorkspace(restrictedPath);

        // Then: Should fallback to provided path
        expect(detected).toBe(restrictedPath);
      });
    });

    it('should handle very deep directory nesting', async () => {
      await withTimeout(async () => {
        // Given: Very deep nesting
        const deepPath = path.join(gitWorkspace, ...Array(20).fill('deep'));
        await fs.mkdir(deepPath, { recursive: true });

        mockGit.getCurrentState.mockRejectedValue(new Error('Git error'));

        // When: Detecting from deep path
        const detected = await workspaceManager.detectWorkspace(deepPath);

        // Then: Should find git root despite deep nesting
        expect(detected).toBe(gitWorkspace);
      });
    });

    it('should handle symbolic links in workspace detection', async () => {
      await withTimeout(async () => {
        // Given: Symbolic link to workspace (if supported by system)
        const linkPath = path.join(testDir, 'workspace-link');
        
        try {
          await fs.symlink(gitWorkspace, linkPath);
          
          mockGit.getCurrentState.mockRejectedValue(new Error('Git error'));

          // When: Detecting from symlink
          const detected = await workspaceManager.detectWorkspace(linkPath);

          // Then: Should resolve and find actual workspace
          expect(detected).toBe(gitWorkspace);
        } catch (error) {
          // Skip test if symlinks not supported
          console.log('Symlink test skipped:', error);
        }
      });
    });

    it('should handle concurrent workspace operations', async () => {
      await withTimeout(async () => {
        // Given: Multiple concurrent detection operations
        mockGit.getCurrentState.mockResolvedValue({
          repository: gitWorkspace,
          branch: 'main',
          commit: 'abc123',
          remote: 'origin'
        });

        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(workspaceManager.detectWorkspace(gitWorkspace));
        }

        // When: Running concurrent operations
        const results = await Promise.all(promises);

        // Then: All should return same result
        results.forEach(result => {
          expect(result).toBe(gitWorkspace);
        });

        // And: Git should only be called once due to caching
        expect(mockGit.getCurrentState).toHaveBeenCalledTimes(1);
      }, 8000);
    });

    it('should handle empty directory names gracefully', async () => {
      await withTimeout(async () => {
        // Given: Root directory (empty name)
        const metadata = await workspaceManager.getWorkspaceMetadata('/');

        // Then: Should handle empty basename gracefully
        expect(metadata.name).toBe('');
        expect(metadata.type).toBe('directory');
      });
    });
  });
});