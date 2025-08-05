import { createLogger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs/promises';
import { GitIntegration } from '../git/integration.js';

const logger = createLogger('WorkspaceManager');

export interface WorkspaceMetadata {
  id: string;
  type: 'git' | 'npm' | 'directory';
  name: string;
  gitRemote?: string;
  packageName?: string;
  detectedAt: Date;
}

export interface WorkspaceConfig {
  storageEnabled: boolean;
  memoryLimit: number;
  sessionTimeout: number;
  gitIntegration: boolean;
  [key: string]: unknown;
}

export class WorkspaceManager {
  private workspaceCache: Map<string, WorkspaceMetadata> = new Map();
  private git?: GitIntegration;

  constructor(git?: GitIntegration) {
    this.git = git;
  }

  async detectWorkspace(startPath?: string): Promise<string> {
    const searchPath = startPath || process.cwd();
    logger.debug('Detecting workspace', { searchPath });

    // Validate that the path exists
    try {
      await fs.access(searchPath);
    } catch (error) {
      throw new Error(`Workspace path does not exist: ${searchPath}`);
    }

    // Check cache first
    const cached = this.findCachedWorkspace(searchPath);
    if (cached) {
      logger.debug('Using cached workspace', { workspace: cached });
      return cached;
    }

    // Try Git repository root
    const gitRoot = await this.getGitRoot(searchPath);
    if (gitRoot) {
      logger.info('Detected Git workspace', { workspace: gitRoot });
      await this.cacheWorkspace(gitRoot, 'git');
      return gitRoot;
    }

    // Try package.json location
    const packageRoot = await this.findPackageRoot(searchPath);
    if (packageRoot) {
      logger.info('Detected NPM workspace', { workspace: packageRoot });
      await this.cacheWorkspace(packageRoot, 'npm');
      return packageRoot;
    }

    // Fallback to current directory
    logger.info('Using directory as workspace', { workspace: searchPath });
    await this.cacheWorkspace(searchPath, 'directory');
    return searchPath;
  }

  async getWorkspaceMetadata(workspaceId: string): Promise<WorkspaceMetadata> {
    // Check cache
    const cached = this.workspaceCache.get(workspaceId);
    if (cached) {
      return cached;
    }

    // Detect type and build metadata
    const metadata: WorkspaceMetadata = {
      id: workspaceId,
      type: 'directory',
      name: path.basename(workspaceId),
      detectedAt: new Date()
    };

    // Check if it's a git repo
    if (await this.isGitRepository(workspaceId)) {
      metadata.type = 'git';
      metadata.gitRemote = await this.getGitRemote(workspaceId);
    }
    // Check if it has package.json
    else if (await this.hasPackageJson(workspaceId)) {
      metadata.type = 'npm';
      metadata.packageName = await this.getPackageName(workspaceId);
    }

    this.workspaceCache.set(workspaceId, metadata);
    return metadata;
  }

  async switchWorkspace(newWorkspaceId: string): Promise<void> {
    logger.info('Switching workspace', { 
      from: this.getCurrentCachedWorkspace(),
      to: newWorkspaceId 
    });

    // Validate new workspace exists
    try {
      await fs.access(newWorkspaceId);
    } catch (error) {
      throw new Error(`Workspace directory does not exist: ${newWorkspaceId}`);
    }

    // Update cache with new workspace as most recent
    await this.cacheWorkspace(newWorkspaceId, 'directory');
  }

  async initializeWorkspace(workspacePath: string): Promise<void> {
    logger.info('Initializing workspace', { workspacePath });
    
    // Validate path exists
    try {
      await fs.access(workspacePath);
    } catch (error) {
      throw new Error(`Workspace path does not exist: ${workspacePath}`);
    }
    
    // Detect and cache workspace
    await this.detectWorkspace(workspacePath);
    
    logger.info('Workspace initialized', { workspacePath });
  }

  async getWorkspaceConfig(workspaceId?: string): Promise<WorkspaceConfig> {
    const workspace = workspaceId || this.getCurrentCachedWorkspace();
    
    // Default configuration
    const defaultConfig: WorkspaceConfig = {
      storageEnabled: true,
      memoryLimit: 100 * 1024 * 1024, // 100MB
      sessionTimeout: 30 * 60 * 1000, // 30 minutes
      gitIntegration: true
    };

    if (!workspace) {
      return defaultConfig;
    }

    // Try to load workspace-specific config
    try {
      const configPath = path.join(workspace, '.claude-memory-config.json');
      const configContent = await fs.readFile(configPath, 'utf-8');
      const workspaceConfig = JSON.parse(configContent) as Partial<WorkspaceConfig>;
      
      return { ...defaultConfig, ...workspaceConfig };
    } catch (error) {
      logger.debug('No workspace config found, using defaults', { workspace, error });
      return defaultConfig;
    }
  }

  async updateWorkspaceMetadata(workspaceId: string, metadata: Record<string, unknown>): Promise<void> {
    logger.info('Updating workspace metadata', { workspaceId, metadata });
    
    const existing = await this.getWorkspaceMetadata(workspaceId);
    const updated = { ...existing, ...metadata, id: workspaceId };
    
    this.workspaceCache.set(workspaceId, updated);
    
    // Optionally persist to workspace config file
    try {
      const configPath = path.join(workspaceId, '.claude-memory-config.json');
      const config = await this.getWorkspaceConfig(workspaceId);
      config.metadata = metadata;
      
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      logger.debug('Workspace metadata persisted', { workspaceId });
    } catch (error) {
      logger.debug('Failed to persist workspace metadata', { workspaceId, error });
    }
  }

  clearCache(): void {
    this.workspaceCache.clear();
    logger.debug('Workspace cache cleared');
  }

  private async getGitRoot(startPath: string): Promise<string | null> {
    // First try using GitIntegration if available
    if (this.git) {
      try {
        const state = await this.git.getCurrentState();
        if (state.repository) {
          return state.repository;
        }
      } catch (error) {
        logger.debug('GitIntegration not available', error);
      }
    }

    // Fallback to manual detection
    let currentPath = path.resolve(startPath);
    const root = path.parse(currentPath).root;

    while (currentPath !== root) {
      try {
        await fs.access(path.join(currentPath, '.git'));
        return currentPath;
      } catch {
        currentPath = path.dirname(currentPath);
      }
    }

    return null;
  }

  private async findPackageRoot(startPath: string): Promise<string | null> {
    let currentPath = path.resolve(startPath);
    const root = path.parse(currentPath).root;

    while (currentPath !== root) {
      try {
        await fs.access(path.join(currentPath, 'package.json'));
        return currentPath;
      } catch {
        currentPath = path.dirname(currentPath);
      }
    }

    return null;
  }

  private async isGitRepository(dirPath: string): Promise<boolean> {
    try {
      await fs.access(path.join(dirPath, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  private async hasPackageJson(dirPath: string): Promise<boolean> {
    try {
      await fs.access(path.join(dirPath, 'package.json'));
      return true;
    } catch {
      return false;
    }
  }

  private async getGitRemote(_workspaceId: string): Promise<string | undefined> {
    if (this.git) {
      try {
        const state = await this.git.getCurrentState();
        return state.remote;
      } catch (error) {
        logger.debug('Failed to get git remote', error);
      }
    }
    return undefined;
  }

  private async getPackageName(workspaceId: string): Promise<string | undefined> {
    try {
      const packageJsonPath = path.join(workspaceId, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content) as unknown;
      // Type guard for package.json
      if (packageJson && typeof packageJson === 'object' && !Array.isArray(packageJson)) {
        const name = (packageJson as Record<string, unknown>).name;
        return typeof name === 'string' ? name : undefined;
      }
      return undefined;
    } catch (error) {
      logger.debug('Failed to read package.json', error);
      return undefined;
    }
  }

  private async cacheWorkspace(workspaceId: string, type: WorkspaceMetadata['type']): Promise<void> {
    const metadata = await this.getWorkspaceMetadata(workspaceId);
    metadata.type = type;
    this.workspaceCache.set(workspaceId, metadata);
  }

  private findCachedWorkspace(searchPath: string): string | null {
    // Check if exact path is cached
    if (this.workspaceCache.has(searchPath)) {
      return searchPath;
    }

    // Check if searchPath is within a cached workspace
    for (const [cachedPath] of this.workspaceCache) {
      if (searchPath.startsWith(cachedPath)) {
        return cachedPath;
      }
    }

    return null;
  }

  private getCurrentCachedWorkspace(): string | undefined {
    // Return the most recently cached workspace
    const entries = Array.from(this.workspaceCache.entries());
    if (entries.length === 0) return undefined;
    
    // Sort by detection time and return the most recent
    entries.sort((a, b) => b[1].detectedAt.getTime() - a[1].detectedAt.getTime());
    return entries[0]?.[0];
  }
}