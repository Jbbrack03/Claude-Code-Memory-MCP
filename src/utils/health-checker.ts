import { createLogger } from "./logger.js";
import type { StorageEngine } from "../storage/engine.js";
import type { HookSystem } from "../hooks/system.js";
import type { GitIntegration } from "../git/integration.js";
import type { IntelligenceLayer } from "../intelligence/layer.js";

const logger = createLogger("HealthChecker");

export enum HealthStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded", 
  UNHEALTHY = "unhealthy"
}

export interface ComponentHealth {
  status: HealthStatus;
  message?: string;
  latency?: number;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  overall: HealthStatus;
  timestamp: Date;
  components: {
    storage: ComponentHealth;
    hooks: ComponentHealth;
    git: ComponentHealth;
    intelligence: ComponentHealth;
  };
  metrics?: {
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage?: NodeJS.CpuUsage;
  };
}

export class HealthChecker {
  private storage?: StorageEngine;
  private hooks?: HookSystem;
  private git?: GitIntegration;
  private intelligence?: IntelligenceLayer;
  private startTime = Date.now();

  constructor(subsystems: {
    storage?: StorageEngine;
    hooks?: HookSystem;
    git?: GitIntegration;
    intelligence?: IntelligenceLayer;
  }) {
    this.storage = subsystems.storage;
    this.hooks = subsystems.hooks;
    this.git = subsystems.git;
    this.intelligence = subsystems.intelligence;
  }

  /**
   * Perform comprehensive health check of all subsystems
   */
  async checkHealth(): Promise<HealthReport> {
    logger.debug("Starting health check");
    const start = Date.now();

    const components = {
      storage: await this.checkStorage(),
      hooks: await this.checkHooks(),
      git: await this.checkGit(),
      intelligence: await this.checkIntelligence()
    };

    // Determine overall health
    const statuses = Object.values(components).map(c => c.status);
    let overall = HealthStatus.HEALTHY;
    
    if (statuses.includes(HealthStatus.UNHEALTHY)) {
      overall = HealthStatus.UNHEALTHY;
    } else if (statuses.includes(HealthStatus.DEGRADED)) {
      overall = HealthStatus.DEGRADED;
    }

    const report: HealthReport = {
      overall,
      timestamp: new Date(),
      components,
      metrics: {
        uptime: Date.now() - this.startTime,
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage()
      }
    };

    const duration = Date.now() - start;
    logger.debug(`Health check completed in ${duration}ms`, { overall, duration });

    return report;
  }

  /**
   * Check storage subsystem health
   */
  async checkStorage(): Promise<ComponentHealth> {
    if (!this.storage) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: "Storage engine not initialized"
      };
    }

    try {
      const start = Date.now();
      
      // Test basic storage operations
      const stats = await this.storage.getStatistics();
      const latency = Date.now() - start;
      
      // Check if storage is responsive
      if (latency > 1000) {
        return {
          status: HealthStatus.DEGRADED,
          message: "Storage operations slow",
          latency,
          details: { stats }
        };
      }

      return {
        status: HealthStatus.HEALTHY,
        latency,
        details: { 
          totalMemories: stats.totalMemories,
          totalSize: stats.totalSize
        }
      };
    } catch (error) {
      logger.error("Storage health check failed", error);
      return {
        status: HealthStatus.UNHEALTHY,
        message: error instanceof Error ? error.message : "Storage check failed"
      };
    }
  }

  /**
   * Check hook system health
   */
  async checkHooks(): Promise<ComponentHealth> {
    if (!this.hooks) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: "Hook system not initialized"
      };
    }

    try {
      const start = Date.now();
      
      // Test hook system with a simple health check event
      const result = await this.hooks.executeHook({
        type: 'health_check',
        data: { test: true },
        timestamp: new Date()
      });
      
      const latency = Date.now() - start;

      return {
        status: HealthStatus.HEALTHY,
        latency,
        details: { 
          hookResult: result ? 'executed' : 'no_hooks_found'
        }
      };
    } catch (error) {
      logger.error("Hook health check failed", error);
      
      // Hook failures are not critical for system operation
      return {
        status: HealthStatus.DEGRADED,
        message: error instanceof Error ? error.message : "Hook check failed"
      };
    }
  }

  /**
   * Check git integration health
   */
  async checkGit(): Promise<ComponentHealth> {
    if (!this.git) {
      return {
        status: HealthStatus.DEGRADED,
        message: "Git integration not initialized"
      };
    }

    try {
      const start = Date.now();
      const state = await this.git.getCurrentState();
      const latency = Date.now() - start;

      if (!state.initialized) {
        return {
          status: HealthStatus.DEGRADED,
          message: "Git not available",
          latency
        };
      }

      return {
        status: HealthStatus.HEALTHY,
        latency,
        details: {
          branch: state.currentBranch,
          isDirty: state.isDirty,
          ahead: state.ahead,
          behind: state.behind
        }
      };
    } catch (error) {
      logger.error("Git health check failed", error);
      
      // Git failures are not critical for core functionality
      return {
        status: HealthStatus.DEGRADED,
        message: error instanceof Error ? error.message : "Git check failed"
      };
    }
  }

  /**
   * Check intelligence layer health
   */
  async checkIntelligence(): Promise<ComponentHealth> {
    if (!this.intelligence) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: "Intelligence layer not initialized"
      };
    }

    try {
      const start = Date.now();
      
      // Test embedding generation
      const embedding = await this.intelligence.generateEmbedding("health check test");
      const latency = Date.now() - start;
      
      // Check if embedding is valid
      if (!Array.isArray(embedding) || embedding.length === 0) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: "Intelligence layer not producing valid embeddings",
          latency
        };
      }

      // Test memory retrieval
      const memories = await this.intelligence.retrieveMemories("test query", { limit: 1 });
      
      return {
        status: HealthStatus.HEALTHY,
        latency,
        details: {
          embeddingDimension: embedding.length,
          memorySearchWorking: Array.isArray(memories)
        }
      };
    } catch (error) {
      logger.error("Intelligence health check failed", error);
      return {
        status: HealthStatus.UNHEALTHY,
        message: error instanceof Error ? error.message : "Intelligence check failed"
      };
    }
  }

  /**
   * Quick health check (basic connectivity only)
   */
  async quickCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      // Just check if basic systems are responsive
      const results = await Promise.allSettled([
        this.storage?.getStatistics(),
        this.git?.getCurrentState()
      ]);

      const failures = results.filter(r => r.status === 'rejected').length;
      
      if (failures === 0) {
        return { healthy: true };
      } else if (failures < results.length) {
        return { healthy: true, message: "Some subsystems degraded" };
      } else {
        return { healthy: false, message: "Multiple subsystems failing" };
      }
    } catch (error) {
      return { 
        healthy: false, 
        message: error instanceof Error ? error.message : "Health check failed"
      };
    }
  }
}