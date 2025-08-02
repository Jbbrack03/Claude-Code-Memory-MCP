import { EventEmitter } from "events";
import { exec } from "child_process";
import { promisify } from "util";
import { createLogger } from "../utils/logger.js";

const execAsync = promisify(exec);
const logger = createLogger("GitMonitor");

export interface GitMonitorConfig {
  autoDetect?: boolean;
  cwd?: string;
  checkInterval?: number;
}

export interface GitState {
  initialized: boolean;
  repository?: string;
  branch?: string;
  currentBranch?: string;
  commit?: string;
  currentCommit?: string;
  isDirty: boolean;
  detached?: boolean;
  changes?: Array<{
    file: string;
    status: 'modified' | 'staged' | 'untracked' | 'deleted';
  }>;
  reason?: string;
}

export interface GitMonitorEvents {
  branchChange: (data: { from: string; to: string }) => void;
  stateChange: (state: GitState) => void;
}

export class GitMonitor extends EventEmitter {
  private config: GitMonitorConfig;
  private repositoryRoot?: string;
  private state: GitState = {
    initialized: false,
    isDirty: false
  };
  private checkIntervalId?: NodeJS.Timeout;
  private execAsync: typeof execAsync;

  constructor(config: GitMonitorConfig = {}, execAsyncOverride?: typeof execAsync) {
    super();
    this.config = {
      autoDetect: config.autoDetect ?? true,
      cwd: config.cwd ?? process.cwd(),
      checkInterval: config.checkInterval ?? 5000 // 5 seconds
    };
    this.execAsync = execAsyncOverride || execAsync;
  }

  async initialize(): Promise<void> {
    logger.info("Initializing Git monitor...");

    try {
      // Check if we're in a git repository
      const isRepo = await this.detectRepository();
      
      if (!isRepo) {
        this.state = {
          initialized: false,
          isDirty: false,
          reason: 'Not a git repository'
        };
        logger.info("Not in a git repository");
        return;
      }

        // Get initial state
      await this.updateState();
      
      logger.info("Git monitor initialized", {
        repository: this.repositoryRoot,
        branch: this.state.currentBranch,
        commit: this.state.currentCommit
      });
    } catch (error) {
      logger.error("Failed to initialize Git monitor", error);
      this.state = {
        initialized: false,
        isDirty: false,
        reason: 'Initialization failed'
      };
    }
  }

  private async detectRepository(): Promise<boolean> {
    try {
      const { stdout } = await this.execAsync('git rev-parse --show-toplevel', {
        cwd: this.config.cwd
      });
      this.repositoryRoot = stdout.trim();
      return true;
    } catch (error) {
      // Not a git repository or git not available
      return false;
    }
  }

  private async updateState(): Promise<void> {
    try {
      // Get current branch
      const branch = await this.getCurrentBranch();
      
      // Get current commit
      const commit = await this.getCurrentCommit();
      
      // Check for changes
      const { isDirty, changes } = await this.getRepositoryStatus();
      
      this.state = {
        initialized: true,
        currentBranch: branch.name,
        currentCommit: commit,
        isDirty,
        detached: branch.detached,
        changes
      };
    } catch (error) {
      logger.error("Failed to update Git state", error);
      throw error;
    }
  }

  private async getCurrentBranch(): Promise<{ name: string; detached: boolean }> {
    try {
      // Try to get branch name
      const { stdout } = await this.execAsync('git branch --show-current', {
        cwd: this.config.cwd
      });
      
      const branchName = stdout.trim();
      
      if (branchName) {
        return { name: branchName, detached: false };
      }
      
      // If empty, we might be in detached HEAD state
      const { stdout: revParse } = await this.execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.config.cwd
      });
      
      return {
        name: revParse.trim() || 'HEAD',
        detached: true
      };
    } catch (error) {
      // Fallback for older git versions
      const { stdout } = await this.execAsync('git symbolic-ref --short HEAD 2>/dev/null || echo "HEAD"', {
        cwd: this.config.cwd,
        shell: '/bin/bash'
      });
      
      const name = stdout.trim();
      return {
        name: name || 'HEAD',
        detached: name === 'HEAD'
      };
    }
  }

  private async getCurrentCommit(): Promise<string | undefined> {
    try {
      const { stdout } = await this.execAsync('git rev-parse HEAD', {
        cwd: this.config.cwd
      });
      return stdout.trim();
    } catch (error) {
      // Might be an empty repository
      return undefined;
    }
  }

  private async getRepositoryStatus(): Promise<{ isDirty: boolean; changes: GitState['changes'] }> {
    try {
      const { stdout } = await this.execAsync('git status --porcelain', {
        cwd: this.config.cwd
      });
      
      if (!stdout.trim()) {
        return { isDirty: false, changes: [] };
      }
      
      const changes: GitState['changes'] = [];
      const lines = stdout.split('\n').filter(line => line.length > 0);
      
      for (const line of lines) {
        if (!line) continue;
        
        const status = line.substring(0, 2);
        const file = line.substring(2).trim();
        
        // First character is index status, second is worktree status
        const indexStatus = status[0];
        const worktreeStatus = status[1];
        
        
        // Handle different git status combinations
        if (status === '??') {
          changes.push({ file, status: 'untracked' });
        } else if (indexStatus === 'A') {
          // New file added to staging
          changes.push({ file, status: 'staged' });
        } else if (indexStatus === 'M' && worktreeStatus === ' ') {
          // File is modified and staged (no further changes)
          changes.push({ file, status: 'staged' });
        } else if (indexStatus === ' ' && worktreeStatus === 'M') {
          // File is modified but not staged
          changes.push({ file, status: 'modified' });
        } else if (indexStatus === 'M' && worktreeStatus === 'M') {
          // File is staged with additional modifications
          changes.push({ file, status: 'modified' });
        } else if (indexStatus === 'D' || worktreeStatus === 'D') {
          changes.push({ file, status: 'deleted' });
        }
      }
      
      return { isDirty: true, changes };
    } catch (error) {
      logger.error("Failed to get repository status", error);
      return { isDirty: false, changes: [] };
    }
  }

  async checkForChanges(): Promise<void> {
    if (!this.state.initialized) {
      return;
    }

    const previousBranch = this.state.currentBranch;
    await this.updateState();

    // Emit branch change event if branch changed
    if (previousBranch && this.state.currentBranch && previousBranch !== this.state.currentBranch) {
      this.emit('branchChange', {
        from: previousBranch,
        to: this.state.currentBranch
      });
    }

    // Always emit state change
    this.emit('stateChange', this.state);
  }

  isGitRepository(): boolean {
    return !!this.repositoryRoot;
  }

  getRepositoryRoot(): string | undefined {
    return this.repositoryRoot;
  }

  getState(): GitState {
    return { ...this.state };
  }
  
  async getCurrentState(): Promise<GitState> {
    if (this.state.initialized) {
      await this.updateState();
    }
    return { ...this.state };
  }

  startWatching(): void {
    if (this.checkIntervalId) {
      return;
    }

    this.checkIntervalId = setInterval(() => {
      this.checkForChanges().catch(error => {
        logger.error("Error during periodic check", error);
      });
    }, this.config.checkInterval).unref();
  }

  stopWatching(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = undefined;
    }
  }

  close(): void {
    this.stopWatching();
    this.removeAllListeners();
  }

  async getRemoteTrackingInfo(): Promise<{ ahead: number; behind: number }> {
    try {
      // Get ahead count
      const { stdout: aheadOutput } = await this.execAsync('git rev-list --count @{upstream}..HEAD', {
        cwd: this.repositoryRoot || this.config.cwd
      });
      
      // Get behind count  
      const { stdout: behindOutput } = await this.execAsync('git rev-list --count HEAD..@{upstream}', {
        cwd: this.repositoryRoot || this.config.cwd
      });
      
      return {
        ahead: parseInt(aheadOutput.trim()) || 0,
        behind: parseInt(behindOutput.trim()) || 0
      };
    } catch (error) {
      logger.debug('No remote tracking branch configured');
      return { ahead: 0, behind: 0 };
    }
  }

  // Type-safe event emitter methods
  on<K extends keyof GitMonitorEvents>(event: K, listener: GitMonitorEvents[K]): this {
    return super.on(event, listener);
  }

  emit<K extends keyof GitMonitorEvents>(event: K, ...args: Parameters<GitMonitorEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}