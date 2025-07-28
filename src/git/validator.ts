import { exec } from "child_process";
import { promisify } from "util";
import { createLogger } from "../utils/logger.js";
import type { Memory } from "../storage/engine.js";

const execAsync = promisify(exec);
const logger = createLogger("GitValidator");

export interface GitValidatorConfig {
  workspacePath?: string;
  cwd?: string;
}

export interface ValidationResult {
  valid: boolean;
  memoryId: string;
  issues: string[];
}

export class GitValidator {
  private config: GitValidatorConfig;
  private isGitRepo: boolean = false;
  private repoPath?: string;

  constructor(config: GitValidatorConfig = {}) {
    this.config = {
      cwd: config.cwd ?? process.cwd(),
      workspacePath: config.workspacePath
    };
  }

  async validateMemory(memory: Memory): Promise<ValidationResult> {
    const issues: string[] = [];
    
    try {
      // Check if we're in a git repository
      if (!await this.checkGitRepository()) {
        return {
          valid: false,
          memoryId: memory.id,
          issues: ['Not a git repository']
        };
      }

      // Validate workspace if configured
      if (this.config.workspacePath && memory.workspaceId) {
        if (memory.workspaceId !== this.config.workspacePath) {
          issues.push('Workspace mismatch');
        }
      }

      // Validate git commit if present
      if (memory.gitCommit) {
        if (!await this.validateCommit(memory.gitCommit)) {
          issues.push(`Commit not found: ${memory.gitCommit}`);
        }
      }

      // Validate git branch if present
      if (memory.gitBranch) {
        if (!await this.validateBranch(memory.gitBranch)) {
          issues.push(`Branch not found: ${memory.gitBranch}`);
        }
      }

      // Validate file references
      if (memory.metadata?.file && memory.gitCommit) {
        if (!await this.validateFileInCommit(memory.metadata.file as string, memory.gitCommit)) {
          issues.push(`File not found in commit: ${String(memory.metadata.file)}`);
        }
      }

      // Validate file content if applicable
      if (memory.eventType === 'file_read' && memory.content && memory.metadata?.file && memory.gitCommit) {
        const fileContent = await this.getFileContentAtCommit(
          memory.metadata.file as string, 
          memory.gitCommit
        );
        if (fileContent !== null && fileContent !== memory.content) {
          issues.push('File content mismatch');
        }
      }

      return {
        valid: issues.length === 0,
        memoryId: memory.id,
        issues
      };
    } catch (error) {
      logger.error("Error validating memory", { memoryId: memory.id, error });
      return {
        valid: false,
        memoryId: memory.id,
        issues: ['Validation error: ' + (error as Error).message]
      };
    }
  }

  async validateMemories(memories: Memory[]): Promise<ValidationResult[]> {
    return Promise.all(memories.map(memory => this.validateMemory(memory)));
  }

  private async checkGitRepository(): Promise<boolean> {
    if (this.isGitRepo && this.repoPath) {
      return true;
    }

    try {
      const { stdout } = await execAsync('git rev-parse --show-toplevel', {
        cwd: this.config.cwd
      });
      this.repoPath = stdout.trim();
      this.isGitRepo = true;
      return true;
    } catch (error) {
      this.isGitRepo = false;
      return false;
    }
  }

  private async validateCommit(commit: string): Promise<boolean> {
    try {
      await execAsync(`git cat-file -e ${commit}^{commit}`, {
        cwd: this.config.cwd
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  private async validateBranch(branch: string): Promise<boolean> {
    try {
      // Check both local and remote branches
      const { stdout } = await execAsync(
        `git branch -a --format='%(refname:short)' | grep -E "^${branch}$|^remotes/[^/]+/${branch}$"`,
        {
          cwd: this.config.cwd,
          shell: '/bin/bash'
        }
      );
      return stdout.trim().length > 0;
    } catch (error) {
      return false;
    }
  }

  private async validateFileInCommit(file: string, commit: string): Promise<boolean> {
    try {
      await execAsync(`git cat-file -e ${commit}:${file}`, {
        cwd: this.config.cwd
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  private async getFileContentAtCommit(file: string, commit: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`git show ${commit}:${file}`, {
        cwd: this.config.cwd
      });
      return stdout;
    } catch (error) {
      return null;
    }
  }
}