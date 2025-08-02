export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  version: string;
  uptime: number;
  components: Record<string, ComponentHealth>;
  metrics?: HealthMetrics;
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  lastCheck: Date;
  metadata?: Record<string, unknown>;
  responseTime?: number;
}

export interface HealthMetrics {
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  responseTime: {
    p50: number;
    p95: number;
    p99: number;
  };
  uptime: number;
  version: string;
}

export type HealthCheckFunction = () => Promise<ComponentHealth>;

export class HealthCheckService {
  private checks: Map<string, HealthCheckFunction> = new Map();
  private lastResults: Map<string, ComponentHealth> = new Map();
  private startTime = Date.now();
  private responseTimes: number[] = [];
  private intervalId?: NodeJS.Timeout;
  
  registerCheck(name: string, check: HealthCheckFunction): void {
    this.checks.set(name, check);
  }
  
  async performHealthCheck(): Promise<HealthCheckResult> {
    const checkStartTime = Date.now();
    const results: Record<string, ComponentHealth> = {};
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    // Run all checks in parallel with timeout
    const checkPromises = Array.from(this.checks.entries()).map(async ([name, check]) => {
      const componentStartTime = Date.now();
      
      try {
        // Add timeout to prevent hanging health checks
        const result = await Promise.race([
          check(),
          new Promise<ComponentHealth>((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          )
        ]);
        
        result.responseTime = Date.now() - componentStartTime;
        results[name] = result;
        this.lastResults.set(name, result);
        
        if (result.status === 'unhealthy') {
          overallStatus = 'unhealthy';
        } else if (result.status === 'degraded' && overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      } catch (error) {
        const failedResult: ComponentHealth = {
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'Check failed',
          lastCheck: new Date(),
          responseTime: Date.now() - componentStartTime
        };
        results[name] = failedResult;
        this.lastResults.set(name, failedResult);
        overallStatus = 'unhealthy';
      }
    });
    
    await Promise.all(checkPromises);
    
    // Track response time for this health check
    const totalResponseTime = Date.now() - checkStartTime;
    this.responseTimes.push(totalResponseTime);
    
    // Keep only last 100 response times
    if (this.responseTimes.length > 100) {
      this.responseTimes = this.responseTimes.slice(-100);
    }
    
    return {
      status: overallStatus,
      timestamp: new Date(),
      version: process.env.npm_package_version || '0.0.0',
      uptime: Date.now() - this.startTime,
      components: results,
      metrics: await this.collectMetrics()
    };
  }
  
  private collectMetrics(): Promise<HealthMetrics> {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Calculate response time percentiles
    const sortedTimes = [...this.responseTimes].sort((a, b) => a - b);
    const p50 = this.percentile(sortedTimes, 0.5);
    const p95 = this.percentile(sortedTimes, 0.95);
    const p99 = this.percentile(sortedTimes, 0.99);
    
    return Promise.resolve({
      memoryUsage: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        rss: memoryUsage.rss,
        external: memoryUsage.external
      },
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      responseTime: {
        p50,
        p95,
        p99
      },
      uptime: process.uptime(),
      version: process.env.npm_package_version || '0.0.0'
    });
  }
  
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)] || 0;
  }
  
  // Get last known status for a component
  getComponentStatus(name: string): ComponentHealth | undefined {
    return this.lastResults.get(name);
  }
  
  // Get all component statuses
  getAllComponentStatuses(): Record<string, ComponentHealth> {
    return Object.fromEntries(this.lastResults);
  }
  
  // Quick status check without full health check
  getQuickStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    memory: number;
    version: string;
  }> {
    const memoryUsage = process.memoryUsage();
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    // Simple health heuristics
    const memoryUsagePercent = memoryUsage.heapUsed / memoryUsage.heapTotal;
    if (memoryUsagePercent > 0.9) {
      status = 'unhealthy';
    } else if (memoryUsagePercent > 0.8) {
      status = 'degraded';
    }
    
    return Promise.resolve({
      status,
      uptime: Date.now() - this.startTime,
      memory: memoryUsage.heapUsed,
      version: process.env.npm_package_version || '0.0.0'
    });
  }
  
  // Register default system health checks
  registerDefaultChecks(): void {
    // Memory usage check
    this.registerCheck('memory', () => {
      const usage = process.memoryUsage();
      const usagePercent = usage.heapUsed / usage.heapTotal;
      
      let status: ComponentHealth['status'] = 'healthy';
      let message = `Memory usage: ${Math.round(usagePercent * 100)}%`;
      
      if (usagePercent > 0.9) {
        status = 'unhealthy';
        message += ' (critical)';
      } else if (usagePercent > 0.8) {
        status = 'degraded';
        message += ' (high)';
      }
      
      return Promise.resolve({
        status,
        message,
        lastCheck: new Date(),
        metadata: {
          heapUsed: usage.heapUsed,
          heapTotal: usage.heapTotal,
          rss: usage.rss,
          usagePercent: Math.round(usagePercent * 100)
        }
      });
    });
    
    // CPU usage check
    this.registerCheck('cpu', () => {
      const usage = process.cpuUsage();
      const totalUsage = usage.user + usage.system;
      
      return Promise.resolve({
        status: 'healthy',
        message: `CPU usage tracked`,
        lastCheck: new Date(),
        metadata: {
          user: usage.user,
          system: usage.system,
          total: totalUsage
        }
      });
    });
    
    // Uptime check
    this.registerCheck('uptime', () => {
      const uptime = process.uptime();
      
      return Promise.resolve({
        status: 'healthy',
        message: `Uptime: ${Math.round(uptime)}s`,
        lastCheck: new Date(),
        metadata: {
          uptime,
          uptimeHuman: this.formatUptime(uptime)
        }
      });
    });
  }
  
  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${secs}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }
  
  // Async health check that runs continuously
  startPeriodicHealthChecks(intervalMs: number = 30000): void {
    const runCheck = async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('Periodic health check failed:', error);
      }
    };
    
    // Run initial check
    void runCheck();
    
    // Schedule periodic checks
    this.intervalId = setInterval(() => void runCheck(), intervalMs);
  }
  
  stopPeriodicHealthChecks(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}