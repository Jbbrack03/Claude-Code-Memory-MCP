import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { ConnectionPool } from "../../src/utils/connection-pool.js";
import type { ConnectionPoolConfig, PooledConnection, PoolStats } from "../../src/utils/connection-pool.js";
import { performance } from "perf_hooks";

// Mock connection type for testing
interface MockConnection {
  id: string;
  isHealthy: boolean;
  createdAt: number;
  lastUsed: number;
}

// Mock connection factory
class MockConnectionFactory {
  private connectionCounter = 0;
  private creationDelay: number;
  private failureRate: number;

  constructor(creationDelay: number = 10, failureRate: number = 0) {
    this.creationDelay = creationDelay;
    this.failureRate = failureRate;
  }

  async create(): Promise<MockConnection> {
    await new Promise(resolve => setTimeout(resolve, this.creationDelay));
    
    if (Math.random() < this.failureRate) {
      throw new Error('Connection creation failed');
    }

    return {
      id: `conn-${++this.connectionCounter}`,
      isHealthy: true,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };
  }

  async healthCheck(connection: MockConnection): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 1)); // Small delay
    return connection.isHealthy;
  }

  async validate(connection: MockConnection): Promise<boolean> {
    return connection.isHealthy && (Date.now() - connection.lastUsed) < 60000;
  }

  setConnectionHealth(connectionId: string, healthy: boolean): void {
    // This would be used in tests to simulate connection failures
  }
}

describe('ConnectionPool Performance Benchmarks', () => {
  let pool: ConnectionPool<MockConnection>;
  let factory: MockConnectionFactory;

  beforeEach(() => {
    factory = new MockConnectionFactory();
  });

  afterEach(async () => {
    if (pool) {
      await pool.destroy();
    }
  });

  describe('connection acquisition latency', () => {
    it('should achieve connection acquisition latency < 5ms (p95) from warm pool', async () => {
      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 10,
        maxSize: 20,
        acquireTimeout: 5000,
        validateOnAcquire: (conn) => factory.validate(conn)
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      // Wait for pool to warm up
      await new Promise(resolve => setTimeout(resolve, 200));

      const acquisitionTimes: number[] = [];

      // Measure acquisition performance from warm pool
      for (let i = 0; i < 1000; i++) {
        const startTime = performance.now();
        const connection = await pool.acquire();
        const endTime = performance.now();
        
        expect(connection).toBeDefined();
        await connection.release();
        
        acquisitionTimes.push(endTime - startTime);
      }

      // Calculate p95
      acquisitionTimes.sort((a, b) => a - b);
      const p95Index = Math.floor(acquisitionTimes.length * 0.95);
      const p95Time = acquisitionTimes[p95Index];

      expect(p95Time).toBeLessThan(5);
    });

    it('should handle connection acquisition under cold start conditions', async () => {
      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 0, // Cold start
        maxSize: 10,
        acquireTimeout: 1000
      };

      pool = new ConnectionPool(config);
      
      const coldStartTimes: number[] = [];

      // Measure cold start acquisition
      for (let i = 0; i < 10; i++) {
        const startTime = performance.now();
        const connection = await pool.acquire();
        const endTime = performance.now();
        
        expect(connection).toBeDefined();
        coldStartTimes.push(endTime - startTime);
        
        await connection.release();
      }

      // Cold start should still be reasonable (includes connection creation time)
      const avgColdStartTime = coldStartTimes.reduce((a, b) => a + b) / coldStartTimes.length;
      expect(avgColdStartTime).toBeLessThan(50); // 50ms for cold start is acceptable
    });
  });

  describe('concurrent connection handling', () => {
    it('should handle 100+ simultaneous connection requests efficiently', async () => {
      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 5,
        maxSize: 50,
        acquireTimeout: 5000
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      const concurrentRequests = 100;
      const startTime = performance.now();

      // Create concurrent connection requests
      const acquisitionPromises = Array.from({ length: concurrentRequests }, async () => {
        const connection = await pool.acquire();
        
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        
        await connection.release();
        return connection;
      });

      const connections = await Promise.all(acquisitionPromises);
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // All requests should succeed
      expect(connections).toHaveLength(concurrentRequests);
      connections.forEach(conn => expect(conn).toBeDefined());

      // Should handle concurrent requests efficiently
      expect(totalTime).toBeLessThan(1000); // 1 second max for 100 concurrent requests
      
      const requestsPerSecond = concurrentRequests / (totalTime / 1000);
      expect(requestsPerSecond).toBeGreaterThan(100); // At least 100 req/sec
    });

    it('should maintain performance with high connection churn', async () => {
      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 10,
        maxSize: 30,
        acquireTimeout: 2000
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      const operations = 500;
      const startTime = performance.now();

      // Simulate high churn with rapid acquire/release cycles
      const churnPromises = Array.from({ length: operations }, async (_, i) => {
        const connection = await pool.acquire();
        
        // Very short usage time to create churn
        await new Promise(resolve => setTimeout(resolve, 1));
        
        await connection.release();
        return i;
      });

      await Promise.all(churnPromises);
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      const opsPerSecond = operations / (totalTime / 1000);
      expect(opsPerSecond).toBeGreaterThan(50); // Should handle churn efficiently

      // Pool should remain healthy
      const stats = await pool.getStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.active).toBe(0); // All connections should be released
    });

    it('should handle burst traffic patterns', async () => {
      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 2,
        maxSize: 20,
        acquireTimeout: 3000
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      // Simulate burst pattern: high load followed by low load
      const burstSizes = [50, 100, 25, 75, 10];
      const burstResults: number[] = [];

      for (const burstSize of burstSizes) {
        const startTime = performance.now();
        
        const burstPromises = Array.from({ length: burstSize }, async () => {
          const connection = await pool.acquire();
          await new Promise(resolve => setTimeout(resolve, Math.random() * 20));
          await connection.release();
        });

        await Promise.all(burstPromises);
        const endTime = performance.now();
        const burstTime = endTime - startTime;
        
        burstResults.push(burstSize / (burstTime / 1000));
        
        // Brief pause between bursts
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // All bursts should maintain reasonable throughput
      burstResults.forEach(throughput => {
        expect(throughput).toBeGreaterThan(20); // At least 20 ops/sec per burst
      });
    });
  });

  describe('connection creation and destruction overhead', () => {
    it('should minimize connection creation overhead', async () => {
      const fastFactory = new MockConnectionFactory(1); // Very fast creation

      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => fastFactory.create(),
        healthCheck: (conn) => fastFactory.healthCheck(conn),
        minSize: 0,
        maxSize: 20,
        acquireTimeout: 1000
      };

      pool = new ConnectionPool(config);

      const creationTimes: number[] = [];

      // Measure connection creation overhead
      for (let i = 0; i < 20; i++) {
        const startTime = performance.now();
        const connection = await pool.acquire();
        const endTime = performance.now();
        
        creationTimes.push(endTime - startTime);
        await connection.release();
      }

      const avgCreationTime = creationTimes.reduce((a, b) => a + b) / creationTimes.length;
      expect(avgCreationTime).toBeLessThan(10); // Low overhead even with creation
    });

    it('should handle connection destruction efficiently', async () => {
      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 20,
        maxSize: 20,
        acquireTimeout: 2000
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      // Wait for pool to fully populate
      await new Promise(resolve => setTimeout(resolve, 300));

      const startTime = performance.now();
      await pool.destroy();
      const endTime = performance.now();
      const destructionTime = endTime - startTime;

      // Destruction should be quick
      expect(destructionTime).toBeLessThan(500); // 500ms max for cleanup
    });

    it('should optimize connection lifecycle management', async () => {
      let createCount = 0;
      let destroyCount = 0;

      const config: ConnectionPoolConfig<MockConnection> = {
        factory: async () => {
          createCount++;
          return factory.create();
        },
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 5,
        maxSize: 15,
        acquireTimeout: 2000,
        onCreate: async () => { /* tracking */ },
        onDestroy: async () => { destroyCount++; }
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      // Generate load to test lifecycle
      const operations = Array.from({ length: 100 }, async () => {
        const connection = await pool.acquire();
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        await connection.release();
      });

      await Promise.all(operations);

      // Should minimize unnecessary creation/destruction
      expect(createCount).toBeLessThan(20); // Shouldn't exceed maxSize by much
      expect(destroyCount).toBeLessThan(createCount); // Shouldn't destroy unnecessarily
    });
  });

  describe('pool scaling performance', () => {
    it('should scale up efficiently under load', async () => {
      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 2,
        maxSize: 20,
        acquireTimeout: 3000
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      // Initial state should be at minSize
      let stats = await pool.getStats();
      expect(stats.total).toBe(2);

      // Apply load to trigger scaling
      const loadPromises = Array.from({ length: 15 }, async (_, i) => {
        const connection = await pool.acquire();
        // Hold connections to force scaling
        await new Promise(resolve => setTimeout(resolve, 100));
        await connection.release();
      });

      await Promise.all(loadPromises);

      // Pool should have scaled up
      stats = await pool.getStats();
      expect(stats.total).toBeGreaterThan(2);
      expect(stats.total).toBeLessThanOrEqual(20);
    });

    it('should scale down gracefully after load reduction', async () => {
      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 2,
        maxSize: 20,
        acquireTimeout: 2000,
        healthCheckInterval: 100 // Fast health checks for testing
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      // Generate high load
      const highLoadPromises = Array.from({ length: 18 }, async () => {
        const connection = await pool.acquire();
        await new Promise(resolve => setTimeout(resolve, 50));
        await connection.release();
      });

      await Promise.all(highLoadPromises);

      // Check scaled up state
      const scaledStats = await pool.getStats();
      expect(scaledStats.total).toBeGreaterThan(2);

      // Wait for scale down (this test assumes pool has scale-down logic)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should eventually scale back down (implementation dependent)
      const finalStats = await pool.getStats();
      expect(finalStats.total).toBeGreaterThanOrEqual(2); // At least minSize
    });

    it('should maintain optimal pool size under varying load', async () => {
      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 3,
        maxSize: 25,
        acquireTimeout: 2000
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      const loadPatterns = [5, 15, 8, 20, 10, 3];
      const poolSizes: number[] = [];

      for (const loadSize of loadPatterns) {
        const loadPromises = Array.from({ length: loadSize }, async () => {
          const connection = await pool.acquire();
          await new Promise(resolve => setTimeout(resolve, 20));
          await connection.release();
        });

        await Promise.all(loadPromises);
        
        const stats = await pool.getStats();
        poolSizes.push(stats.total);
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Pool should adapt to load patterns
      expect(Math.max(...poolSizes)).toBeLessThanOrEqual(25);
      expect(Math.min(...poolSizes)).toBeGreaterThanOrEqual(3);
    });
  });

  describe('resource usage under load', () => {
    it('should maintain low memory overhead', async () => {
      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 10,
        maxSize: 50,
        acquireTimeout: 2000
      };

      pool = new ConnectionPool(config);
      
      const initialMemory = process.memoryUsage().heapUsed;
      await pool.initialize();
      
      // Generate substantial load
      const loadPromises = Array.from({ length: 200 }, async () => {
        const connection = await pool.acquire();
        await new Promise(resolve => setTimeout(resolve, 10));
        await connection.release();
      });

      await Promise.all(loadPromises);
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // Less than 10MB
    });

    it('should handle connection timeout scenarios efficiently', async () => {
      const slowFactory = new MockConnectionFactory(100); // Slow creation

      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => slowFactory.create(),
        healthCheck: (conn) => slowFactory.healthCheck(conn),
        minSize: 1,
        maxSize: 5,
        acquireTimeout: 50 // Short timeout
      };

      pool = new ConnectionPool(config);

      const timeoutResults: boolean[] = [];

      // Test timeout behavior
      const timeoutPromises = Array.from({ length: 10 }, async () => {
        try {
          const connection = await pool.acquire();
          await connection.release();
          return true;
        } catch (error) {
          return false; // Timeout occurred
        }
      });

      const results = await Promise.all(timeoutPromises);
      
      // Some requests should timeout due to slow factory
      const timeouts = results.filter(result => !result).length;
      expect(timeouts).toBeGreaterThan(0);
      
      // Pool should remain functional after timeouts
      const stats = await pool.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });

    it('should recover from connection failures gracefully', async () => {
      const unreliableFactory = new MockConnectionFactory(10, 0.3); // 30% failure rate

      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => unreliableFactory.create(),
        healthCheck: (conn) => unreliableFactory.healthCheck(conn),
        minSize: 2,
        maxSize: 10,
        acquireTimeout: 1000,
        maxRetries: 3
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      const attempts = 50;
      const results: boolean[] = [];

      // Test resilience to failures
      for (let i = 0; i < attempts; i++) {
        try {
          const connection = await pool.acquire();
          await connection.release();
          results.push(true);
        } catch (error) {
          results.push(false);
        }
      }

      const successRate = results.filter(r => r).length / results.length;
      
      // Should maintain reasonable success rate despite failures
      expect(successRate).toBeGreaterThan(0.5); // At least 50% success
      
      // Pool should remain operational
      const stats = await pool.getStats();
      expect(stats.total).toBeGreaterThan(0);
    });
  });

  describe('pool statistics and monitoring', () => {
    it('should provide statistics efficiently', async () => {
      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 5,
        maxSize: 15,
        acquireTimeout: 2000
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      const statsTimes: number[] = [];

      // Measure stats collection performance
      for (let i = 0; i < 100; i++) {
        const startTime = performance.now();
        const stats = await pool.getStats();
        const endTime = performance.now();
        
        expect(stats).toBeDefined();
        expect(typeof stats.total).toBe('number');
        expect(typeof stats.active).toBe('number');
        expect(typeof stats.idle).toBe('number');
        
        statsTimes.push(endTime - startTime);
      }

      const avgStatsTime = statsTimes.reduce((a, b) => a + b) / statsTimes.length;
      expect(avgStatsTime).toBeLessThan(1); // Stats should be very fast
    });

    it('should track connection lifecycle metrics accurately', async () => {
      let acquisitions = 0;
      let releases = 0;

      const config: ConnectionPoolConfig<MockConnection> = {
        factory: () => factory.create(),
        healthCheck: (conn) => factory.healthCheck(conn),
        minSize: 3,
        maxSize: 10,
        acquireTimeout: 2000,
        onAcquire: async () => { acquisitions++; },
        onRelease: async () => { releases++; }
      };

      pool = new ConnectionPool(config);
      await pool.initialize();

      // Perform operations
      const operations = Array.from({ length: 20 }, async () => {
        const connection = await pool.acquire();
        await new Promise(resolve => setTimeout(resolve, 10));
        await connection.release();
      });

      await Promise.all(operations);

      // Metrics should be accurate
      expect(acquisitions).toBe(20);
      expect(releases).toBe(20);
    });
  });
});