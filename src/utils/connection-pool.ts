import { EventEmitter } from 'node:events';

/**
 * Configuration for connection pool
 */
export interface ConnectionPoolConfig<T> {
  /** Factory function to create connections */
  factory: () => Promise<T>;
  /** Function to check connection health */
  healthCheck: (connection: T) => Promise<boolean>;
  /** Minimum number of connections to maintain */
  minSize?: number;
  /** Maximum number of connections allowed */
  maxSize?: number;
  /** Timeout for acquiring connections in milliseconds */
  acquireTimeout?: number;
  /** Interval for health checks in milliseconds */
  healthCheckInterval?: number;
  /** Function to validate connection before acquisition */
  validateOnAcquire?: (connection: T) => Promise<boolean>;
  /** Maximum retry attempts for connection creation */
  maxRetries?: number;
  /** Lifecycle hooks */
  onCreate?: (connection: T) => Promise<void>;
  onDestroy?: (connection: T) => Promise<void>;
  onAcquire?: (connection: T) => Promise<void>;
  onRelease?: (connection: T) => Promise<void>;
  /** Event handler */
  onEvent?: (type: string, data: unknown) => void;
}

/**
 * Pooled connection wrapper
 */
export interface PooledConnection<T> {
  /** The actual connection */
  connection: T;
  /** Release the connection back to the pool */
  release: () => Promise<void>;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  /** Total connections in pool */
  total: number;
  /** Active (in-use) connections */
  active: number;
  /** Idle (available) connections */
  idle: number;
  /** Number of waiters in queue */
  waiting: number;
  /** Total connections created */
  created: number;
  /** Total connections destroyed */
  destroyed: number;
}

interface WaitingRequest<T> {
  resolve: (conn: PooledConnection<T>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface InternalConnection<T> {
  connection: T;
  inUse: boolean;
  createdAt: number;
}

/**
 * Generic connection pool implementation
 */
export class ConnectionPool<T> extends EventEmitter {
  private readonly config: Required<Omit<ConnectionPoolConfig<T>, 'onCreate' | 'onDestroy' | 'onAcquire' | 'onRelease' | 'onEvent' | 'validateOnAcquire'>>;
  private readonly lifecycle: Pick<ConnectionPoolConfig<T>, 'onCreate' | 'onDestroy' | 'onAcquire' | 'onRelease' | 'onEvent' | 'validateOnAcquire'>;
  private readonly connections: Set<InternalConnection<T>> = new Set();
  private readonly waitingQueue: WaitingRequest<T>[] = [];
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isShutdown = false;
  private recreationScheduled = false;
  private stats = {
    created: 0,
    destroyed: 0
  };

  constructor(config: ConnectionPoolConfig<T>) {
    super();
    
    this.config = {
      factory: config.factory,
      healthCheck: config.healthCheck,
      minSize: config.minSize ?? 0,
      maxSize: config.maxSize ?? 10,
      acquireTimeout: config.acquireTimeout ?? 30000,
      healthCheckInterval: config.healthCheckInterval ?? 30000,
      maxRetries: config.maxRetries ?? 3
    };

    this.lifecycle = {
      onCreate: config.onCreate,
      onDestroy: config.onDestroy,
      onAcquire: config.onAcquire,
      onRelease: config.onRelease,
      onEvent: config.onEvent,
      validateOnAcquire: config.validateOnAcquire
    };
  }

  /**
   * Initialize the pool
   */
  async initialize(): Promise<void> {
    if (this.isShutdown) {
      throw new Error('Pool is shut down');
    }

    // Create minimum connections
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.config.minSize; i++) {
      promises.push(this.createConnection());
    }

    try {
      await Promise.all(promises);
    } catch (error) {
      throw new Error('Failed to create minimum connections');
    }

    // Start health check interval
    if (this.config.healthCheckInterval > 0) {
      this.healthCheckInterval = setInterval(() => {
        this.performHealthChecks().catch(() => {
          // Health check errors are logged but don't crash the pool
        });
      }, this.config.healthCheckInterval);
    }

    this.emitEvent('pool:initialized', { stats: this.getStats() });
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<PooledConnection<T>> {
    if (this.isShutdown) {
      throw new Error('Pool is shut down');
    }

    // Try to get an idle connection
    let conn = await this.getIdleConnection();
    
    if (!conn) {
      // No idle connections, check if we can create a new one
      if (this.connections.size < this.config.maxSize) {
        await this.createConnection();
        conn = await this.getIdleConnection();
      }
    }

    if (conn) {
      conn.inUse = true;
      
      if (this.lifecycle.onAcquire) {
        try {
          await this.lifecycle.onAcquire(conn.connection);
        } catch {
          // Ignore lifecycle errors
        }
      }

      this.emitEvent('connection:acquired', { 
        stats: this.getStats() 
      });

      return {
        connection: conn.connection,
        release: async () => {
          if (this.isShutdown) {
            return;
          }
          
          // Always check health on release to detect unhealthy connections immediately
          try {
            const isHealthy = await this.config.healthCheck(conn.connection);
            if (!isHealthy) {
              await this.destroyConnection(conn);
              // Schedule recreation to maintain minimum pool size
              this.scheduleRecreation();
              return;
            }
          } catch {
            // Health check error, destroy connection
            await this.destroyConnection(conn);
            return;
          }
          
          conn.inUse = false;
          
          if (this.lifecycle.onRelease) {
            try {
              await this.lifecycle.onRelease(conn.connection);
            } catch {
              // Ignore lifecycle errors
            }
          }

          this.emitEvent('connection:released', { 
            stats: this.getStats() 
          });

          // Check if there are waiting requests
          void this.processWaitingQueue();
        }
      };
    }

    // No connections available, add to waiting queue
    return this.waitForConnection();
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    let active = 0;
    let idle = 0;

    for (const conn of Array.from(this.connections)) {
      if (conn.inUse) {
        active++;
      } else {
        idle++;
      }
    }

    return {
      total: this.connections.size,
      active,
      idle,
      waiting: this.waitingQueue.length,
      created: this.stats.created,
      destroyed: this.stats.destroyed
    };
  }

  /**
   * Shutdown the pool
   */
  async shutdown(): Promise<void> {
    this.isShutdown = true;

    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Reject all waiting requests
    while (this.waitingQueue.length > 0) {
      const waiter = this.waitingQueue.shift();
      if (waiter) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error('Pool is shutting down'));
      }
    }

    // Close all connections
    const promises: Promise<void>[] = [];
    for (const conn of Array.from(this.connections)) {
      promises.push(this.destroyConnection(conn));
    }

    await Promise.all(promises);
    this.connections.clear();

    this.emitEvent('pool:shutdown', { stats: this.getStats() });
  }

  private async createConnection(): Promise<void> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const connection = await this.config.factory();
        
        if (this.lifecycle.onCreate) {
          try {
            await this.lifecycle.onCreate(connection);
          } catch {
            // Ignore lifecycle errors
          }
        }

        const internalConn: InternalConnection<T> = {
          connection,
          inUse: false,
          createdAt: Date.now()
        };

        this.connections.add(internalConn);
        this.stats.created++;
        
        this.emitEvent('connection:created', { 
          stats: this.getStats() 
        });
        
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.config.maxRetries) {
          // Retry
          continue;
        }
      }
    }

    throw lastError || new Error('Failed to create connection');
  }

  private async destroyConnection(conn: InternalConnection<T>): Promise<void> {
    this.connections.delete(conn);
    this.stats.destroyed++;

    // Call close method if it exists FIRST
    if (conn.connection && typeof (conn.connection as Record<string, unknown>).close === 'function') {
      try {
        await (conn.connection as unknown as { close: () => Promise<void> }).close();
      } catch {
        // Ignore close errors
      }
    }

    // Then call onDestroy lifecycle hook
    if (this.lifecycle.onDestroy) {
      try {
        await this.lifecycle.onDestroy(conn.connection);
      } catch {
        // Ignore lifecycle errors but ensure they're called
      }
    }

    this.emitEvent('connection:destroyed', { 
      stats: this.getStats() 
    });
  }

  private async getIdleConnection(): Promise<InternalConnection<T> | null> {
    for (const conn of Array.from(this.connections)) {
      if (!conn.inUse) {
        // Validate if configured
        if (this.lifecycle.validateOnAcquire) {
          try {
            const isValid = await this.lifecycle.validateOnAcquire(conn.connection);
            if (!isValid) {
              // Remove invalid connection
              await this.destroyConnection(conn);
              continue;
            }
          } catch {
            // Treat validation errors as invalid
            await this.destroyConnection(conn);
            continue;
          }
        }
        
        return conn;
      }
    }
    return null;
  }

  private async waitForConnection(): Promise<PooledConnection<T>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitingQueue.findIndex(w => w.timeout === timeout);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
        }
        reject(new Error('Connection acquisition timeout'));
      }, this.config.acquireTimeout);

      this.waitingQueue.push({ resolve, reject, timeout });
    });
  }

  private async processWaitingQueue(): Promise<void> {
    while (this.waitingQueue.length > 0) {
      const conn = await this.getIdleConnection();
      if (!conn) {
        break;
      }

      const waiter = this.waitingQueue.shift();
      if (waiter) {
        clearTimeout(waiter.timeout);
        conn.inUse = true;
        
        if (this.lifecycle.onAcquire) {
          try {
            await this.lifecycle.onAcquire(conn.connection);
          } catch {
            // Ignore lifecycle errors
          }
        }

        this.emitEvent('connection:acquired', { 
          stats: this.getStats() 
        });

        waiter.resolve({
          connection: conn.connection,
          release: async () => {
            if (this.isShutdown) {
              return;
            }
            
            // Always check health on release to detect unhealthy connections immediately
            try {
              const isHealthy = await this.config.healthCheck(conn.connection);
              if (!isHealthy) {
                await this.destroyConnection(conn);
                // Schedule recreation to maintain minimum pool size
                this.scheduleRecreation();
                return;
              }
            } catch {
              // Health check error, destroy connection
              await this.destroyConnection(conn);
              return;
            }
            
            conn.inUse = false;
            
            if (this.lifecycle.onRelease) {
              try {
                await this.lifecycle.onRelease(conn.connection);
              } catch {
                // Ignore lifecycle errors
              }
            }

            this.emitEvent('connection:released', { 
              stats: this.getStats() 
            });

            void this.processWaitingQueue();
          }
        });
      }
    }
  }

  private async performHealthChecks(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const conn of Array.from(this.connections)) {
      if (!conn.inUse) {
        promises.push(this.checkConnectionHealth(conn));
      }
    }

    await Promise.all(promises);

    // Schedule recreation with a small delay to allow observation of removed connections
    this.scheduleRecreation();
  }

  private async ensureMinimumPoolSize(): Promise<void> {
    const currentSize = this.connections.size;
    if (currentSize < this.config.minSize) {
      const toCreate = Math.min(
        this.config.minSize - currentSize,
        this.config.maxSize - currentSize
      );
      const createPromises: Promise<void>[] = [];
      
      for (let i = 0; i < toCreate; i++) {
        createPromises.push(this.createConnection().catch(() => {
          // Ignore creation errors during health check
        }));
      }
      
      await Promise.all(createPromises);
    }
  }

  private async checkConnectionHealth(conn: InternalConnection<T>): Promise<void> {
    try {
      const isHealthy = await this.config.healthCheck(conn.connection);
      if (!isHealthy) {
        await this.destroyConnection(conn);
      }
    } catch {
      // Health check error, remove connection
      await this.destroyConnection(conn);
    }
  }

  private emitEvent(type: string, data: unknown): void {
    if (this.lifecycle.onEvent) {
      this.lifecycle.onEvent(type, data);
    }
    this.emit(type, data);
  }

  private scheduleRecreation(): void {
    if (this.connections.size < this.config.minSize && !this.recreationScheduled && !this.isShutdown) {
      this.recreationScheduled = true;
      setTimeout(() => {
        this.recreationScheduled = false;
        if (!this.isShutdown) {
          this.ensureMinimumPoolSize().catch(() => {
            // Ignore errors in background recreation
          });
        }
      }, 150);
    }
  }
}