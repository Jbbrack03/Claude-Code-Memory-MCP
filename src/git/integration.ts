import { createLogger } from "../utils/logger.js";
import type { Config } from "../config/index.js";
import { GitMonitor, type GitState as MonitorState } from "./monitor.js";
import { GitValidator } from "./validator.js";
import type { Memory } from "../storage/engine.js";

const logger = createLogger("GitIntegration");

export interface GitState extends MonitorState {
  remote?: string;
  behind: number;
  ahead: number;
}

export class GitIntegration {
  private config: Config["git"];
  private initialized = false;
  private monitor?: GitMonitor;
  private validator?: GitValidator;

  constructor(config: Config["git"]) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    logger.info("Initializing Git integration...");
    
    if (!this.config.enabled) {
      logger.info("Git integration disabled");
      return;
    }

    // Initialize Git monitor
    this.monitor = new GitMonitor({
      autoDetect: true,
      checkInterval: this.config.validation.checkInterval
    });
    await this.monitor.initialize();

    // Initialize Git validator
    this.validator = new GitValidator({
      workspacePath: process.cwd()
    });

    // Start monitoring if we're in a git repository
    if (this.monitor.isGitRepository()) {
      this.monitor.startWatching();
      
      // Listen for branch changes
      this.monitor.on('branchChange', (data) => {
        logger.info("Branch changed", data);
      });

      // Listen for state changes
      this.monitor.on('stateChange', (state) => {
        logger.debug("Git state changed", state);
      });
    }
    
    this.initialized = true;
    logger.info("Git integration initialized", {
      isGitRepo: this.monitor.isGitRepository(),
      repoRoot: this.monitor.getRepositoryRoot()
    });
  }

  async getCurrentState(): Promise<GitState> {
    if (!this.initialized || !this.config.enabled || !this.monitor) {
      return {
        initialized: false,
        isDirty: false,
        behind: 0,
        ahead: 0
      };
    }

    const monitorState = await this.monitor.getCurrentState();
    
    // TODO: Get remote tracking info (behind/ahead counts)
    
    return {
      ...monitorState,
      behind: 0,
      ahead: 0
    };
  }

  async validateMemory(memory: Memory): Promise<boolean> {
    if (!this.initialized || !this.config.enabled || !this.validator) {
      return true;
    }

    logger.debug("Validating memory against Git", { memoryId: memory.id });
    
    const result = await this.validator.validateMemory(memory);
    
    if (!result.valid) {
      logger.warn("Memory validation failed", {
        memoryId: memory.id,
        issues: result.issues
      });
    }
    
    return result.valid;
  }

  async close(): Promise<void> {
    logger.info("Closing Git integration...");
    
    if (this.monitor) {
      this.monitor.close();
    }
    
    this.initialized = false;
    logger.info("Git integration closed");
  }
}