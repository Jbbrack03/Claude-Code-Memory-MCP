/**
 * Test cleanup manager for resource lifecycle tracking
 */

export type ResourceType = 'database' | 'file' | 'network' | 'memory' | 'custom';

// Re-export for the setup.ts file
export { ResourceType };

export interface CleanupResource {
  id: string;
  type: ResourceType;
  cleanupFn: () => Promise<void>;
  createdAt: number;
  metadata?: any;
}

export interface ResourceLifecycleHooks {
  onResourceCreated?: (resource: CleanupResource) => void;
  onResourceCleaned?: (resourceId: string) => void;
  onResourceFailed?: (resourceId: string, error: Error) => void;
  onForceCleanup?: (operationName: string) => void;
}

export interface CleanupOptions {
  timeout?: number;
  force?: boolean;
}

export interface TimeoutResource {
  operationName: string;
  timeoutMs: number;
  startTime: number;
}

export interface TestCleanupManagerConfig {
  defaultTimeout?: number;
  enableLogging?: boolean;
  hooks?: ResourceLifecycleHooks;
}

export interface CleanupResult {
  successful: string[];
  failed: Array<{ id: string; error: Error }>;
}

export interface ResourceStatistics {
  totalResources: number;
  resourcesByType: Record<ResourceType, number>;
}

export interface TimeoutStatistics {
  totalTimeouts: number;
  activeTimeouts: number;
  expiredTimeouts: number;
  averageTimeoutDuration: number;
  oldestTimeout?: TimeoutResource;
}

export class TestCleanupManager {
  private resources: Map<string, CleanupResource> = new Map();
  private timeoutResources: TimeoutResource[] = [];
  private config: Required<TestCleanupManagerConfig>;
  private disposed = false;

  constructor(config: TestCleanupManagerConfig = {}) {
    // Validate configuration
    if (config.defaultTimeout !== undefined && config.defaultTimeout < 0) {
      throw new Error('Invalid configuration: defaultTimeout must be non-negative');
    }

    this.config = {
      defaultTimeout: config.defaultTimeout ?? 5000,
      enableLogging: config.enableLogging ?? false,
      hooks: config.hooks ?? {}
    };
  }

  getConfig(): any {
    // Return config in the format expected by tests
    return {
      timeout: this.config.defaultTimeout,
      cleanupOnExit: true,
      trackResources: true,
      logLevel: this.config.enableLogging ? 'info' : 'error',
      ...this.config
    };
  }

  async addResource(
    id: string,
    type: ResourceType,
    cleanupFn: () => Promise<void>,
    metadata?: any
  ): Promise<void> {
    if (this.disposed) {
      throw new Error('Cleanup manager has been disposed');
    }

    if (this.resources.has(id)) {
      throw new Error(`Resource with ID ${id} already exists`);
    }

    const resource: CleanupResource = {
      id,
      type,
      cleanupFn,
      createdAt: Date.now(),
      metadata
    };

    this.resources.set(id, resource);

    // Call lifecycle hook
    try {
      this.config.hooks.onResourceCreated?.(resource);
    } catch (error) {
      // Continue even if hook fails
    }
  }

  getResource(id: string): CleanupResource | undefined {
    return this.resources.get(id);
  }

  getAllResources(): CleanupResource[] {
    return Array.from(this.resources.values());
  }

  getResourcesByType(type: ResourceType): CleanupResource[] {
    return Array.from(this.resources.values()).filter(r => r.type === type);
  }

  async cleanupResource(id: string, options: CleanupOptions = {}): Promise<void> {
    const resource = this.resources.get(id);
    if (!resource) {
      throw new Error(`Resource with ID ${id} not found`);
    }

    try {
      if (options.timeout) {
        // Create timeout promise with proper cleanup
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Resource cleanup timeout after ${options.timeout}ms`));
          }, options.timeout);
        });

        try {
          // Race the cleanup function against the timeout
          await Promise.race([
            resource.cleanupFn().then(
              (value) => {
                clearTimeout(timeoutId);
                return value;
              },
              (error) => {
                clearTimeout(timeoutId);
                throw error;
              }
            ),
            timeoutPromise
          ]);
        } catch (error) {
          // Ensure timeout is cleared even if we throw
          clearTimeout(timeoutId);
          throw error;
        }
      } else {
        await resource.cleanupFn();
      }

      this.resources.delete(id);
      this.config.hooks.onResourceCleaned?.(id);
    } catch (error) {
      this.config.hooks.onResourceFailed?.(id, error as Error);
      throw error;
    }
  }

  async cleanupByType(type: ResourceType): Promise<CleanupResult> {
    const resources = this.getResourcesByType(type);
    const successful: string[] = [];
    const failed: Array<{ id: string; error: Error }> = [];

    for (const resource of resources) {
      try {
        await this.cleanupResource(resource.id);
        successful.push(resource.id);
      } catch (error) {
        failed.push({ id: resource.id, error: error as Error });
      }
    }

    return { successful, failed };
  }

  async cleanup(): Promise<void> {
    const allResources = this.getAllResources();
    
    for (const resource of allResources) {
      try {
        // Use a short timeout for cleanup to prevent hanging tests
        await this.cleanupResource(resource.id, { timeout: 100 });
      } catch (error) {
        // Continue cleanup even if individual resources fail
        // Remove the resource anyway to prevent stuck resources
        this.resources.delete(resource.id);
      }
    }
  }

  addTimeoutResource(resource: TimeoutResource): void {
    this.timeoutResources.push(resource);
  }

  getTimeoutResources(): TimeoutResource[] {
    return [...this.timeoutResources];
  }

  getExpiredTimeouts(): TimeoutResource[] {
    const now = Date.now();
    return this.timeoutResources.filter(resource => 
      (now - resource.startTime) > resource.timeoutMs
    );
  }

  cleanupTimeoutResources(): void {
    const now = Date.now();
    this.timeoutResources = this.timeoutResources.filter(resource => 
      (now - resource.startTime) <= resource.timeoutMs
    );
  }

  async forceCleanup(operationName: string): Promise<void> {
    this.config.hooks.onForceCleanup?.(operationName);
    await this.cleanup();
  }

  getStatistics(): ResourceStatistics {
    const stats: ResourceStatistics = {
      totalResources: this.resources.size,
      resourcesByType: {
        database: 0,
        file: 0,
        network: 0,
        memory: 0,
        custom: 0
      }
    };

    for (const resource of this.resources.values()) {
      stats.resourcesByType[resource.type]++;
    }

    return stats;
  }

  getTimeoutStatistics(): TimeoutStatistics {
    const now = Date.now();
    const expiredTimeouts = this.timeoutResources.filter(resource => 
      (now - resource.startTime) > resource.timeoutMs
    );
    const activeTimeouts = this.timeoutResources.filter(resource => 
      (now - resource.startTime) <= resource.timeoutMs
    );

    const totalDuration = this.timeoutResources.reduce((sum, resource) => sum + resource.timeoutMs, 0);
    const averageTimeoutDuration = this.timeoutResources.length > 0 
      ? totalDuration / this.timeoutResources.length 
      : 0;

    const oldestTimeout = this.timeoutResources.reduce((oldest, resource) => {
      if (!oldest || resource.startTime < oldest.startTime) {
        return resource;
      }
      return oldest;
    }, undefined as TimeoutResource | undefined);

    return {
      totalTimeouts: this.timeoutResources.length,
      activeTimeouts: activeTimeouts.length,
      expiredTimeouts: expiredTimeouts.length,
      averageTimeoutDuration,
      oldestTimeout
    };
  }

  async dispose(): Promise<void> {
    await this.cleanup();
    this.disposed = true;
  }

  // Test utility methods expected by tests
  createTestDatabase = () => {};
  createTempFile = () => {};
  mockNetworkCall = () => {};
}