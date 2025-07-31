import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { GitMonitor } from "../../src/git/monitor.js";

// Create a mock for exec that we'll inject
const createMockExec = () => {
  const mockExec = jest.fn();
  const promisifiedExec = (cmd: string, options: any) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mockExec(cmd, options, (err: any, stdout: any, stderr: any) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  };
  return { mockExec, promisifiedExec };
};

describe('GitMonitor Remote Tracking', () => {
  let monitor: GitMonitor;
  const { mockExec, promisifiedExec } = createMockExec();

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create monitor and inject the mocked execAsync
    monitor = new GitMonitor({
      autoDetect: true,
      checkInterval: 1000
    });
    
    // Override the internal execAsync with our mock
    (monitor as any).execAsync = promisifiedExec;
  });

  afterEach(() => {
    monitor.close();
  });

  describe('getRemoteTrackingInfo', () => {
    it('should return ahead and behind counts when tracking branch exists', async () => {
      // Mock git commands
      mockExec.mockImplementation((cmd: string, options: any, callback: any) => {
        if (cmd.includes('rev-list --count @{upstream}..HEAD')) {
          callback(null, '5\n', '');
        } else if (cmd.includes('rev-list --count HEAD..@{upstream}')) {
          callback(null, '3\n', '');
        } else {
          callback(new Error('Unknown command'), null, null);
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
      mockExec.mockImplementation((_cmd: string, _options: any, callback: any) => {
        callback(new Error('fatal: no upstream configured'), null, null);
      });

      const result = await monitor.getRemoteTrackingInfo();

      expect(result).toEqual({
        ahead: 0,
        behind: 0
      });
    });

    it('should handle zero counts correctly', async () => {
      // Mock git commands with zero counts
      mockExec.mockImplementation((cmd: string, _options: any, callback: any) => {
        if (cmd.includes('rev-list --count')) {
          callback(null, '0\n', '');
        } else {
          callback(new Error('Unknown command'), null, null);
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
      mockExec.mockImplementation((cmd: string, _options: any, callback: any) => {
        if (cmd.includes('rev-list --count @{upstream}..HEAD')) {
          callback(null, '1234\n', '');
        } else if (cmd.includes('rev-list --count HEAD..@{upstream}')) {
          callback(null, '5678\n', '');
        } else {
          callback(new Error('Unknown command'), null, null);
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
      mockExec.mockImplementation((cmd: string, options: any, callback: any) => {
        if (options && typeof options === 'object') {
          capturedCwd = options.cwd;
        }
        if (cmd.includes('rev-list --count @{upstream}..HEAD')) {
          callback(null, '1\n', '');
        } else if (cmd.includes('rev-list --count HEAD..@{upstream}')) {
          callback(null, '0\n', '');
        } else {
          callback(new Error('Unknown command'), null, null);
        }
      });

      const result = await monitor.getRemoteTrackingInfo();

      expect(capturedCwd).toBe('/path/to/repo');
      expect(result).toEqual({ ahead: 1, behind: 0 });
    });

    it('should fall back to config cwd when repository root not set', async () => {
      const customCwd = '/custom/path';
      monitor = new GitMonitor({ cwd: customCwd });
      
      // Re-inject the mock after creating new monitor
      (monitor as any).execAsync = promisifiedExec;

      let capturedCwd: string | undefined;
      mockExec.mockImplementation((cmd: string, options: any, callback: any) => {
        if (options && typeof options === 'object') {
          capturedCwd = options.cwd;
        }
        if (cmd.includes('rev-list --count @{upstream}..HEAD')) {
          callback(null, '1\n', '');
        } else if (cmd.includes('rev-list --count HEAD..@{upstream}')) {
          callback(null, '0\n', '');
        } else {
          callback(new Error('Unknown command'), null, null);
        }
      });

      const result = await monitor.getRemoteTrackingInfo();

      expect(capturedCwd).toBe(customCwd);
      expect(result).toEqual({ ahead: 1, behind: 0 });
    });
  });
});