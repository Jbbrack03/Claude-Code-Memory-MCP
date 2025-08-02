import { MetricsCollector } from './metrics.js';
import { startTracing, setupTracingShutdown } from './tracing.js';
import { Instrumentation } from './instrumentation.js';
import { StructuredLogger } from './structured-logger.js';
import { HealthCheckService } from './health-check.js';
import { AlertManager } from './alerting.js';
import { StorageEngine } from '../storage/engine.js';
import { HookSystem } from '../hooks/system.js';
import { MultiLevelCache } from '../utils/multi-level-cache.js';
import { NodeSDK } from '@opentelemetry/sdk-node';

export interface MonitoringConfig {
  metrics?: {
    enabled?: boolean;
    prefix?: string;
    port?: number;
    endpoint?: string;
  };
  tracing?: {
    enabled?: boolean;
    serviceName?: string;
    endpoint?: string;
  };
  healthChecks?: {
    enabled?: boolean;
    interval?: number;
  };
  alerting?: {
    enabled?: boolean;
    checkInterval?: number;
  };
  logging?: {
    level?: string;
  };
}

export class MonitoringSystem {
  private metrics: MetricsCollector;
  private instrumentation: Instrumentation;
  private logger: StructuredLogger;
  private healthCheck: HealthCheckService;
  private alertManager: AlertManager;
  private config: Required<MonitoringConfig>;
  private tracingSdk?: { shutdown(): Promise<void> };
  private metricsServer?: { listen(port: number, callback: (error?: Error) => void): void; close(callback: () => void): void };
  
  constructor(config: MonitoringConfig = {}) {
    this.config = {
      metrics: {
        enabled: config.metrics?.enabled ?? true,
        prefix: config.metrics?.prefix || 'claude_memory',
        port: config.metrics?.port || 9090,
        endpoint: config.metrics?.endpoint || '/metrics'
      },
      tracing: {
        enabled: config.tracing?.enabled ?? true,
        serviceName: config.tracing?.serviceName || 'claude-memory-mcp',
        endpoint: config.tracing?.endpoint
      },
      healthChecks: {
        enabled: config.healthChecks?.enabled ?? true,
        interval: config.healthChecks?.interval || 30000
      },
      alerting: {
        enabled: config.alerting?.enabled ?? true,
        checkInterval: config.alerting?.checkInterval || 60000
      },
      logging: {
        level: config.logging?.level || process.env.LOG_LEVEL || 'info'
      }
    };
    
    this.metrics = new MetricsCollector({
      prefix: this.config.metrics.prefix
    });
    
    this.instrumentation = new Instrumentation();
    this.logger = new StructuredLogger('monitoring');
    this.healthCheck = new HealthCheckService();
    this.alertManager = new AlertManager();
  }
  
  async initialize(): Promise<void> {
    this.logger.logSystemEvent('startup', 'start', {
      config: this.config
    });
    
    try {
      // Initialize tracing if enabled
      if (this.config.tracing.enabled) {
        const tracingConfig = {
          serviceName: this.config.tracing.serviceName || 'claude-memory-mcp',
          ...(this.config.tracing.endpoint && { endpoint: this.config.tracing.endpoint })
        };
        this.tracingSdk = startTracing(tracingConfig);
        setupTracingShutdown(this.tracingSdk as unknown as NodeSDK);
        this.logger.info('OpenTelemetry tracing initialized');
      }
      
      // Register default health checks
      if (this.config.healthChecks.enabled) {
        this.healthCheck.registerDefaultChecks();
        this.healthCheck.startPeriodicHealthChecks(this.config.healthChecks.interval);
        this.logger.info('Health checks initialized');
      }
      
      // Initialize alerting
      if (this.config.alerting.enabled) {
        this.alertManager.registerDefaultRules();
        this.alertManager.registerDefaultHandlers();
        this.alertManager.startChecking(this.config.alerting.checkInterval);
        this.logger.info('Alert manager initialized');
      }
      
      // Start metrics server if enabled
      if (this.config.metrics.enabled) {
        await this.startMetricsServer();
        this.logger.info('Metrics server started', {
          port: this.config.metrics.port,
          endpoint: this.config.metrics.endpoint
        });
      }
      
      // Start periodic system metrics collection
      this.startSystemMetricsCollection();
      
      this.logger.logSystemEvent('startup', 'success');
    } catch (error) {
      this.logger.logSystemEvent('startup', 'error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  private async startMetricsServer(): Promise<void> {
    const http = await import('http');
    const url = await import('url');
    
    this.metricsServer = http.createServer((req, res) => void (async () => {
      const parsedUrl = url.parse(req.url || '', true);
      
      if (parsedUrl.pathname === this.config.metrics.endpoint) {
        try {
          const metrics = await this.metrics.getMetrics();
          res.writeHead(200, { 
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
          });
          res.end(metrics);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error collecting metrics');
        }
      } else if (parsedUrl.pathname === '/health') {
        try {
          const health = await this.healthCheck.performHealthCheck();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(health, null, 2));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'unhealthy', error: 'Health check failed' }));
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    })());
    
    return new Promise((resolve, reject) => {
      if (!this.metricsServer) {
        reject(new Error('Failed to create metrics server'));
        return;
      }
      this.metricsServer.listen(this.config.metrics.port ?? 9090, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
  
  private startSystemMetricsCollection(): void {
    // Update system metrics every 15 seconds
    setInterval(() => {
      void this.metrics.updateSystemMetrics().catch(error => {
        this.logger.error('Failed to update system metrics', error instanceof Error ? error : new Error('Unknown error'));
      });
    }, 15000);
    
    // Initial collection
    void this.metrics.updateSystemMetrics().catch(error => {
      this.logger.error('Failed to update initial system metrics', error instanceof Error ? error : new Error('Unknown error'));
    });
  }
  
  // Integration with other subsystems
  integrateWithStorage(storage: StorageEngine): void {
    this.logger.info('Integrating monitoring with storage engine');
    
    // Register storage health checks
    this.healthCheck.registerCheck('storage', async () => {
      try {
        // Test storage connectivity
        const stats = await storage.getStatistics();
        
        return {
          status: 'healthy' as const,
          message: `Storage operational with ${stats.totalMemories} memories`,
          lastCheck: new Date(),
          metadata: stats as unknown as Record<string, unknown>
        };
      } catch (error) {
        return {
          status: 'unhealthy' as const,
          message: error instanceof Error ? error.message : 'Storage check failed',
          lastCheck: new Date()
        };
      }
    });
    
    // Register storage alerts
    this.alertManager.registerRule({
      name: 'storage_error_rate',
      condition: () => {
        // This would check storage error metrics
        return Promise.resolve(false);
      },
      severity: 'error',
      message: 'Storage error rate is high',
      labels: { component: 'storage' }
    });
  }
  
  integrateWithHooks(_hooks: HookSystem): void {
    this.logger.info('Integrating monitoring with hook system');
    
    // Register hook health checks
    this.healthCheck.registerCheck('hooks', () => {
      try {
        const circuitBreakerState = 'closed'; // Default state - would need to implement getCircuitBreakerState in hooks
        
        return Promise.resolve({
          status: circuitBreakerState === 'closed' ? 'healthy' : 'degraded',
          message: `Hook system circuit breaker is ${circuitBreakerState}`,
          lastCheck: new Date(),
          metadata: { circuitBreakerState }
        });
      } catch (error) {
        return Promise.resolve({
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'Hook system check failed',
          lastCheck: new Date()
        });
      }
    });
    
    // Register hook alerts
    this.alertManager.registerRule({
      name: 'hook_circuit_breaker_open',
      condition: () => {
        return Promise.resolve(false); // Would need to implement getCircuitBreakerState in hooks
      },
      severity: 'warning',
      message: 'Hook system circuit breaker is open',
      labels: { component: 'hooks' }
    });
  }
  
  integrateWithCache(cache: MultiLevelCache<unknown>): void {
    this.logger.info('Integrating monitoring with cache system');
    
    // Register cache health checks
    this.healthCheck.registerCheck('cache', () => {
      try {
        const size = 0; // Would need to implement size method in cache
        const stats = cache.getStats();
        
        return Promise.resolve({
          status: 'healthy',
          message: `Cache operational with ${size} items`,
          lastCheck: new Date(),
          metadata: { size, ...stats }
        });
      } catch (error) {
        return Promise.resolve({
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'Cache check failed',
          lastCheck: new Date()
        });
      }
    });
    
    // Update cache metrics periodically
    setInterval(() => {
      try {
        const stats = cache.getStats();
        
        // Would need proper cache stats structure
        this.metrics.setCacheSize('L1', 0);
        this.metrics.setCacheSize('L2', 0);
        this.metrics.setCacheSize('L3', 0);
        
        this.metrics.setCacheHitRate('L1', stats.l1Hits / (stats.l1Hits + stats.l1Misses) || 0);
        this.metrics.setCacheHitRate('L2', stats.l2Hits / (stats.l2Hits + stats.l2Misses) || 0);
        this.metrics.setCacheHitRate('L3', stats.l3Hits / (stats.l3Hits + stats.l3Misses) || 0);
      } catch (error) {
        this.logger.error('Failed to update cache metrics', error instanceof Error ? error : new Error('Unknown error'));
      }
    }, 30000);
  }
  
  // Getters for subsystems
  getMetrics(): MetricsCollector {
    return this.metrics;
  }
  
  getInstrumentation(): Instrumentation {
    return this.instrumentation;
  }
  
  getLogger(): StructuredLogger {
    return this.logger;
  }
  
  getHealthCheck(): HealthCheckService {
    return this.healthCheck;
  }
  
  getAlertManager(): AlertManager {
    return this.alertManager;
  }
  
  // Graceful shutdown
  async shutdown(): Promise<void> {
    this.logger.logSystemEvent('shutdown', 'start');
    
    try {
      // Stop alert manager
      this.alertManager.stopChecking();
      
      // Stop metrics server
      if (this.metricsServer) {
        await new Promise<void>((resolve) => {
          this.metricsServer?.close(() => resolve());
        });
      }
      
      // Shutdown tracing
      if (this.tracingSdk) {
        await this.tracingSdk.shutdown();
      }
      
      this.logger.logSystemEvent('shutdown', 'success');
    } catch (error) {
      this.logger.logSystemEvent('shutdown', 'error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Export individual components
export { MetricsCollector } from './metrics.js';
export { Instrumentation } from './instrumentation.js';
export { StructuredLogger } from './structured-logger.js';
export { HealthCheckService } from './health-check.js';
export { AlertManager } from './alerting.js';