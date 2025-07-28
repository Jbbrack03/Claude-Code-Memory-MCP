import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { GitMonitor } from "../../src/git/monitor.js";
import { exec } from "child_process";

// Mock child_process module
jest.mock("child_process");

describe('GitMonitor Remote Tracking', () => {
  let monitor: GitMonitor;

  beforeEach(() => {
    jest.clearAllMocks();
    monitor = new GitMonitor({
      autoDetect: true,
      checkInterval: 1000
    });
  });

  afterEach(() => {
    monitor.close();
  });

  describe('getRemoteTrackingInfo', () => {
    it('should return ahead and behind counts when tracking branch exists', async () => {
      // Mock git commands
      (exec as any).mockImplementation((cmd: string, _options: any, callback: any) => {
        if (cmd.includes('rev-list --count @{upstream}..HEAD')) {
          callback(null, { stdout: '5\n', stderr: '' });
        } else if (cmd.includes('rev-list --count HEAD..@{upstream}')) {
          callback(null, { stdout: '3\n', stderr: '' });
        } else {
          callback(new Error('Unknown command'));
        }
      });

      const result = await monitor.getRemoteTrackingInfo();

      expect(result).toEqual({
        ahead: 5,
        behind: 3
      });
    });

    it('should return zeros when no remote tracking branch configured', async () => {
      // Mock git commands to fail (no upstream)
      (exec as any).mockImplementation((_cmd: string, _options: any, callback: any) => {
        callback(new Error('fatal: no upstream configured'));
      });

      const result = await monitor.getRemoteTrackingInfo();

      expect(result).toEqual({
        ahead: 0,
        behind: 0
      });
    });

    it('should handle zero counts correctly', async () => {
      // Mock git commands with zero counts
      (exec as any).mockImplementation((cmd: string, _options: any, callback: any) => {
        if (cmd.includes('rev-list --count')) {
          callback(null, { stdout: '0\n', stderr: '' });
        } else {
          callback(new Error('Unknown command'));
        }
      });

      const result = await monitor.getRemoteTrackingInfo();

      expect(result).toEqual({
        ahead: 0,
        behind: 0
      });
    });

    it('should handle large counts', async () => {
      // Mock git commands with large counts
      (exec as any).mockImplementation((cmd: string, _options: any, callback: any) => {
        if (cmd.includes('rev-list --count @{upstream}..HEAD')) {
          callback(null, { stdout: '1234\n', stderr: '' });
        } else if (cmd.includes('rev-list --count HEAD..@{upstream}')) {
          callback(null, { stdout: '5678\n', stderr: '' });
        } else {
          callback(new Error('Unknown command'));
        }
      });

      const result = await monitor.getRemoteTrackingInfo();

      expect(result).toEqual({
        ahead: 1234,
        behind: 5678
      });
    });

    it('should use repository root when available', async () => {
      // Set up monitor with repository root
      (monitor as any).repositoryRoot = '/path/to/repo';

      let capturedCwd: string | undefined;
      (exec as any).mockImplementation((_cmd: string, options: any, callback: any) => {
        capturedCwd = options.cwd;
        callback(null, { stdout: '1\n', stderr: '' });
      });

      await monitor.getRemoteTrackingInfo();

      expect(capturedCwd).toBe('/path/to/repo');
    });

    it('should fall back to config cwd when repository root not set', async () => {
      const customCwd = '/custom/path';
      monitor = new GitMonitor({ cwd: customCwd });

      let capturedCwd: string | undefined;
      (exec as any).mockImplementation((_cmd: string, options: any, callback: any) => {
        capturedCwd = options.cwd;
        callback(null, { stdout: '1\n', stderr: '' });
      });

      await monitor.getRemoteTrackingInfo();

      expect(capturedCwd).toBe(customCwd);
    });
  });
});