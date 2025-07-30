import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { GitMonitor } from "../../src/git/monitor.js";
import { GitIntegration } from "../../src/git/integration.js";
import { execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { config } from "../../src/config/index.js";

describe('Production Git Remote Tracking Tests', () => {
  let gitMonitor: GitMonitor;
  let gitIntegration: GitIntegration;
  const testRepoPath = '/tmp/test-git-remote';
  const remoteRepoPath = '/tmp/test-git-remote-origin';

  beforeEach(async () => {
    // Clean up test directories
    try {
      await fs.rm(testRepoPath, { recursive: true, force: true });
      await fs.rm(remoteRepoPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore if doesn't exist
    }

    // Create test directories
    await fs.mkdir(testRepoPath, { recursive: true });
    await fs.mkdir(remoteRepoPath, { recursive: true });

    // Initialize remote repo
    execSync('git init --bare', { cwd: remoteRepoPath });

    // Initialize local repo
    execSync('git init', { cwd: testRepoPath });
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath });
    execSync('git config user.name "Test User"', { cwd: testRepoPath });
    execSync(`git remote add origin ${remoteRepoPath}`, { cwd: testRepoPath });

    // Create initial commit
    await fs.writeFile(path.join(testRepoPath, 'README.md'), '# Test Repo\n');
    execSync('git add README.md', { cwd: testRepoPath });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath });
    execSync('git push -u origin master', { cwd: testRepoPath });

    // Change to test directory
    process.chdir(testRepoPath);

    // Initialize Git components
    gitMonitor = new GitMonitor({
      autoDetect: true,
      checkInterval: 1000
    });
    await gitMonitor.initialize();

    gitIntegration = new GitIntegration(config.git);
    await gitIntegration.initialize();
  });

  afterEach(async () => {
    // Clean up
    if (gitMonitor) {
      gitMonitor.close();
    }
    if (gitIntegration) {
      await gitIntegration.close();
    }

    // Change back to original directory
    process.chdir(__dirname);

    // Clean up test directories
    try {
      await fs.rm(testRepoPath, { recursive: true, force: true });
      await fs.rm(remoteRepoPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors
    }
  });

  describe('Remote Tracking Information', () => {
    it('should detect remote tracking branch', async () => {
      // Given: Repository with remote tracking set up

      // When: Getting remote tracking info
      const trackingInfo = await gitMonitor.getRemoteTrackingInfo();

      // Then: Should have correct tracking info
      expect(trackingInfo.ahead).toBe(0);
      expect(trackingInfo.behind).toBe(0);
    });

    it('should detect when local is ahead of remote', async () => {
      // Given: Local commits not pushed
      await fs.writeFile(path.join(testRepoPath, 'newfile.txt'), 'New content');
      execSync('git add newfile.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add new file"', { cwd: testRepoPath });

      // When: Getting remote tracking info
      const trackingInfo = await gitMonitor.getRemoteTrackingInfo();

      // Then: Should show 1 commit ahead
      expect(trackingInfo.ahead).toBe(1);
      expect(trackingInfo.behind).toBe(0);
    });

    it('should detect when local is behind remote', async () => {
      // Given: Create a commit on remote by cloning and pushing
      const tempClonePath = '/tmp/test-git-clone';
      try {
        execSync(`git clone ${remoteRepoPath} ${tempClonePath}`, { stdio: 'pipe' });
        execSync('git config user.email "other@example.com"', { cwd: tempClonePath });
        execSync('git config user.name "Other User"', { cwd: tempClonePath });
        
        await fs.writeFile(path.join(tempClonePath, 'remote-file.txt'), 'Remote content');
        execSync('git add remote-file.txt', { cwd: tempClonePath });
        execSync('git commit -m "Remote commit"', { cwd: tempClonePath });
        execSync('git push origin master', { cwd: tempClonePath });
        
        // Fetch in local repo to update remote tracking
        execSync('git fetch', { cwd: testRepoPath });

        // When: Getting remote tracking info
        const trackingInfo = await gitMonitor.getRemoteTrackingInfo();

        // Then: Should show 1 commit behind
        expect(trackingInfo.ahead).toBe(0);
        expect(trackingInfo.behind).toBe(1);
      } finally {
        // Clean up clone
        try {
          await fs.rm(tempClonePath, { recursive: true, force: true });
        } catch (error) {
          // Ignore
        }
      }
    });

    it('should handle diverged branches', async () => {
      // Given: Local and remote have different commits
      // First, create a remote commit
      const tempClonePath = '/tmp/test-git-clone2';
      try {
        execSync(`git clone ${remoteRepoPath} ${tempClonePath}`, { stdio: 'pipe' });
        execSync('git config user.email "other@example.com"', { cwd: tempClonePath });
        execSync('git config user.name "Other User"', { cwd: tempClonePath });
        
        await fs.writeFile(path.join(tempClonePath, 'remote-change.txt'), 'Remote change');
        execSync('git add remote-change.txt', { cwd: tempClonePath });
        execSync('git commit -m "Remote change"', { cwd: tempClonePath });
        execSync('git push origin master', { cwd: tempClonePath });

        // Create local commit
        await fs.writeFile(path.join(testRepoPath, 'local-change.txt'), 'Local change');
        execSync('git add local-change.txt', { cwd: testRepoPath });
        execSync('git commit -m "Local change"', { cwd: testRepoPath });

        // Fetch to update remote tracking
        execSync('git fetch', { cwd: testRepoPath });

        // When: Getting remote tracking info
        const trackingInfo = await gitMonitor.getRemoteTrackingInfo();

        // Then: Should show both ahead and behind
        expect(trackingInfo.ahead).toBe(1);
        expect(trackingInfo.behind).toBe(1);
      } finally {
        // Clean up clone
        try {
          await fs.rm(tempClonePath, { recursive: true, force: true });
        } catch (error) {
          // Ignore
        }
      }
    });
  });

  describe('Branch Tracking Scenarios', () => {
    it('should handle no remote tracking branch', async () => {
      // Given: Create a new local branch with no remote
      execSync('git checkout -b feature-branch', { cwd: testRepoPath });

      // When: Getting remote tracking info
      const trackingInfo = await gitMonitor.getRemoteTrackingInfo();

      // Then: Should return zeros (no tracking)
      expect(trackingInfo.ahead).toBe(0);
      expect(trackingInfo.behind).toBe(0);
    });

    it('should track multiple branches correctly', async () => {
      // Given: Multiple branches with different states
      // Create and push feature branch
      execSync('git checkout -b feature-1', { cwd: testRepoPath });
      await fs.writeFile(path.join(testRepoPath, 'feature1.txt'), 'Feature 1');
      execSync('git add feature1.txt', { cwd: testRepoPath });
      execSync('git commit -m "Feature 1"', { cwd: testRepoPath });
      execSync('git push -u origin feature-1', { cwd: testRepoPath });

      // Add local commit
      await fs.writeFile(path.join(testRepoPath, 'feature1-local.txt'), 'Local feature 1');
      execSync('git add feature1-local.txt', { cwd: testRepoPath });
      execSync('git commit -m "Local feature 1 change"', { cwd: testRepoPath });

      // Track feature-1 branch
      let trackingInfo = await gitMonitor.getRemoteTrackingInfo();
      expect(trackingInfo.ahead).toBe(1);
      expect(trackingInfo.behind).toBe(0);

      // Switch to main branch
      execSync('git checkout master', { cwd: testRepoPath });

      // Track main branch
      trackingInfo = await gitMonitor.getRemoteTrackingInfo();
      expect(trackingInfo.ahead).toBe(0);
      expect(trackingInfo.behind).toBe(0);
    });
  });

  describe('Integration with Memory System', () => {
    it('should include remote tracking in git state', async () => {
      // Given: Repository with various states
      await fs.writeFile(path.join(testRepoPath, 'tracked.txt'), 'Tracked content');
      execSync('git add tracked.txt', { cwd: testRepoPath });
      execSync('git commit -m "Add tracked file"', { cwd: testRepoPath });

      // When: Getting current state through integration
      const state = await gitIntegration.getCurrentState();

      // Then: Should include tracking info
      expect(state).toMatchObject({
        initialized: true,
        isDirty: false,
        behind: 0,
        ahead: 1 // One unpushed commit
      });
    });

    it('should handle disconnected scenarios gracefully', async () => {
      // Given: Remove remote to simulate disconnected state
      execSync('git remote remove origin', { cwd: testRepoPath });

      // When: Getting remote tracking info
      const trackingInfo = await gitMonitor.getRemoteTrackingInfo();

      // Then: Should handle gracefully
      expect(trackingInfo.ahead).toBe(0);
      expect(trackingInfo.behind).toBe(0);
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle multiple tracking info requests efficiently', async () => {
      // Given: Multiple sequential requests
      const numRequests = 5;
      const times: number[] = [];
      
      // When: Making sequential requests
      for (let i = 0; i < numRequests; i++) {
        const start = Date.now();
        const info = await gitMonitor.getRemoteTrackingInfo();
        const time = Date.now() - start;
        times.push(time);
        
        // Verify info is consistent
        expect(info.ahead).toBe(0);
        expect(info.behind).toBe(0);
      }

      // Then: All requests should complete reasonably quickly
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avgTime).toBeLessThan(100); // Should average less than 100ms
    });

    it('should handle concurrent tracking requests', async () => {
      // Given: Multiple concurrent requests
      const concurrentRequests = 20;
      const promises = [];

      // When: Making many concurrent requests
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(gitMonitor.getRemoteTrackingInfo());
      }

      const results = await Promise.all(promises);

      // Then: All should return same result without errors
      const firstResult = results[0];
      results.forEach(result => {
        expect(result).toEqual(firstResult);
      });
    });

    it('should recover from git command failures', async () => {
      // Given: Corrupt git state
      const gitDir = path.join(testRepoPath, '.git');
      const configBackup = await fs.readFile(path.join(gitDir, 'config'), 'utf-8');
      
      // Corrupt config temporarily
      await fs.writeFile(path.join(gitDir, 'config'), 'invalid content');

      // When: Getting tracking info
      const trackingInfo = await gitMonitor.getRemoteTrackingInfo();

      // Then: Should return safe defaults
      expect(trackingInfo.ahead).toBe(0);
      expect(trackingInfo.behind).toBe(0);

      // Restore config
      await fs.writeFile(path.join(gitDir, 'config'), configBackup);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should track through rebase operations', async () => {
      // Given: Create commits to rebase
      for (let i = 0; i < 3; i++) {
        await fs.writeFile(path.join(testRepoPath, `file${i}.txt`), `Content ${i}`);
        execSync(`git add file${i}.txt`, { cwd: testRepoPath });
        execSync(`git commit -m "Commit ${i}"`, { cwd: testRepoPath });
      }

      // Push to remote
      execSync('git push origin master', { cwd: testRepoPath });

      // Create more local commits
      for (let i = 3; i < 5; i++) {
        await fs.writeFile(path.join(testRepoPath, `file${i}.txt`), `Content ${i}`);
        execSync(`git add file${i}.txt`, { cwd: testRepoPath });
        execSync(`git commit -m "Commit ${i}"`, { cwd: testRepoPath });
      }

      // When: Getting tracking info during rebase
      const beforeRebase = await gitMonitor.getRemoteTrackingInfo();
      expect(beforeRebase.ahead).toBe(2);

      // Note: Interactive rebase not supported, but we can test the tracking after changes
    });

    it('should handle force push scenarios', async () => {
      // Given: Diverged history
      await fs.writeFile(path.join(testRepoPath, 'original.txt'), 'Original');
      execSync('git add original.txt', { cwd: testRepoPath });
      execSync('git commit -m "Original commit"', { cwd: testRepoPath });
      execSync('git push origin master', { cwd: testRepoPath });

      // Amend the commit
      await fs.writeFile(path.join(testRepoPath, 'original.txt'), 'Amended');
      execSync('git add original.txt', { cwd: testRepoPath });
      execSync('git commit --amend -m "Amended commit"', { cwd: testRepoPath });

      // When: Getting tracking info after amend
      execSync('git fetch', { cwd: testRepoPath });
      const trackingInfo = await gitMonitor.getRemoteTrackingInfo();

      // Then: Should show divergence
      expect(trackingInfo.ahead).toBeGreaterThan(0);
      expect(trackingInfo.behind).toBeGreaterThan(0);
    });

    it('should track shallow clones correctly', async () => {
      // Given: Create a shallow clone
      const shallowPath = '/tmp/test-git-shallow';
      try {
        execSync(`git clone --depth 1 ${remoteRepoPath} ${shallowPath}`, { stdio: 'pipe' });
        
        // Initialize monitor in shallow clone
        process.chdir(shallowPath);
        const shallowMonitor = new GitMonitor({
          autoDetect: true
        });
        await shallowMonitor.initialize();

        // When: Getting tracking info
        const trackingInfo = await shallowMonitor.getRemoteTrackingInfo();

        // Then: Should handle shallow clone
        expect(trackingInfo.ahead).toBe(0);
        expect(trackingInfo.behind).toBe(0);

        shallowMonitor.close();
      } finally {
        process.chdir(testRepoPath);
        try {
          await fs.rm(shallowPath, { recursive: true, force: true });
        } catch (error) {
          // Ignore
        }
      }
    });
  });
});