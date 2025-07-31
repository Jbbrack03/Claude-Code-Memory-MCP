import { ConnectionPool, ConnectionPoolConfig, PooledConnection } from '../../src/utils/connection-pool.js';
import { jest } from '@jest/globals';

// Mock connection factory for testing
interface MockConnection {
  id: string;
  isHealthy: boolean;
  close: jest.Mock;
  query: jest.Mock;
}

const createMockConnection = (id: string): MockConnection => ({
  id,
  isHealthy: true,
  close: jest.fn(),
  query: jest.fn().mockResolvedValue({ rows: [] })
});

describe('ConnectionPool', () => {
  let pool: ConnectionPool<MockConnection>;
  let connectionFactory: jest.Mock<() => Promise<MockConnection>>;
  let healthCheck: jest.Mock<(conn: MockConnection) => Promise<boolean>>;
  let onConnectionCreate: jest.Mock;
  let onConnectionDestroy: jest.Mock;
  let connectionIdCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    connectionIdCounter = 0;
    
    connectionFactory = jest.fn().mockImplementation(async () => {
      const conn = createMockConnection(`conn-${++connectionIdCounter}`);
      return conn;
    });

    healthCheck = jest.fn().mockImplementation(async (conn: MockConnection) => {
      return conn.isHealthy;
    });

    onConnectionCreate = jest.fn();
    onConnectionDestroy = jest.fn();
  });

  afterEach(async () => {
    if (pool) {
      await pool.shutdown();
    }
  });

  describe('Pool Initialization', () => {
    it('should create pool with default configuration', async () => {
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck
      });

      await pool.initialize();
      
      const stats = pool.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(stats.idle).toBeGreaterThanOrEqual(0);
      expect(stats.active).toBe(0);
      expect(stats.waiting).toBe(0);
    });

    it('should create minimum number of connections on initialization', async () => {
      const minSize = 3;
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize,
        maxSize: 10
      });

      await pool.initialize();

      expect(connectionFactory).toHaveBeenCalledTimes(minSize);
      const stats = pool.getStats();
      expect(stats.total).toBe(minSize);
      expect(stats.idle).toBe(minSize);
    });

    it('should call onCreate lifecycle hook for each connection', async () => {
      const minSize = 2;
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize,
        onCreate: onConnectionCreate
      });

      await pool.initialize();

      expect(onConnectionCreate).toHaveBeenCalledTimes(minSize);
      expect(onConnectionCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'conn-1' }));
      expect(onConnectionCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'conn-2' }));
    });
  });

  describe('Connection Acquisition', () => {
    beforeEach(async () => {
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize: 2,
        maxSize: 5
      });
      await pool.initialize();
    });

    it('should acquire connection from pool', async () => {
      const conn = await pool.acquire();
      
      expect(conn).toBeDefined();
      expect(conn.connection).toHaveProperty('id');
      expect(conn.connection).toHaveProperty('query');
      
      const stats = pool.getStats();
      expect(stats.active).toBe(1);
      expect(stats.idle).toBe(1);
    });

    it('should reuse released connections', async () => {
      const conn1 = await pool.acquire();
      const connectionId = conn1.connection.id;
      
      await conn1.release();
      
      const conn2 = await pool.acquire();
      expect(conn2.connection.id).toBe(connectionId);
    });

    it('should create new connections when pool is empty up to maxSize', async () => {
      // Acquire all initial connections
      const connections = [];
      for (let i = 0; i < 2; i++) {
        connections.push(await pool.acquire());
      }

      // Should create new connection
      const newConn = await pool.acquire();
      expect(newConn).toBeDefined();
      
      const stats = pool.getStats();
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(3);
      expect(connectionFactory).toHaveBeenCalledTimes(3);
    });

    it('should enforce maximum pool size', async () => {
      // Acquire max connections
      const connections = [];
      for (let i = 0; i < 5; i++) {
        connections.push(await pool.acquire());
      }

      const stats = pool.getStats();
      expect(stats.total).toBe(5);
      expect(stats.active).toBe(5);
      expect(stats.idle).toBe(0);
    });
  });

  describe('Connection Waiting Queue', () => {
    beforeEach(async () => {
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize: 1,
        maxSize: 2,
        acquireTimeout: 100
      });
      await pool.initialize();
    });

    it('should queue requests when pool is exhausted', async () => {
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();

      let stats = pool.getStats();
      expect(stats.active).toBe(2);
      expect(stats.idle).toBe(0);

      // This should wait
      const waitPromise = pool.acquire();
      
      // Check waiting queue
      await new Promise(resolve => setTimeout(resolve, 10));
      stats = pool.getStats();
      expect(stats.waiting).toBe(1);

      // Release a connection
      await conn1.release();

      // Waiting request should now complete
      const conn3 = await waitPromise;
      expect(conn3).toBeDefined();
      
      stats = pool.getStats();
      expect(stats.waiting).toBe(0);
      expect(stats.active).toBe(2);
    });

    it('should timeout when waiting too long', async () => {
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();

      // This should timeout
      await expect(pool.acquire()).rejects.toThrow('Connection acquisition timeout');
      
      const stats = pool.getStats();
      expect(stats.waiting).toBe(0);
    });

    it('should handle multiple waiting requests in order', async () => {
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();

      const results: string[] = [];
      
      // Create multiple waiting requests
      const wait1 = pool.acquire().then(conn => {
        results.push('wait1');
        return conn;
      });
      
      const wait2 = pool.acquire().then(conn => {
        results.push('wait2');
        return conn;
      });

      await new Promise(resolve => setTimeout(resolve, 10));
      let stats = pool.getStats();
      expect(stats.waiting).toBe(2);

      // Release connections
      await conn1.release();
      await conn2.release();

      // Wait for all acquisitions to complete
      const [w1, w2] = await Promise.all([wait1, wait2]);
      
      expect(results).toEqual(['wait1', 'wait2']);
      expect(w1).toBeDefined();
      expect(w2).toBeDefined();
    });
  });

  describe('Connection Health Checks', () => {
    beforeEach(async () => {
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize: 2,
        maxSize: 5,
        healthCheckInterval: 50
      });
      await pool.initialize();
    });

    it('should perform health checks on idle connections', async () => {
      // Wait for health check interval
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(healthCheck).toHaveBeenCalled();
      expect(healthCheck.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should remove unhealthy connections from pool', async () => {
      const conn = await pool.acquire();
      
      // Mark connection as unhealthy
      conn.connection.isHealthy = false;
      await conn.release();

      // Wait for health check
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = pool.getStats();
      expect(stats.total).toBe(1); // One healthy connection remaining
    });

    it('should recreate connections to maintain minimum pool size', async () => {
      // Mark all connections as unhealthy
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();
      
      conn1.connection.isHealthy = false;
      conn2.connection.isHealthy = false;
      
      await conn1.release();
      await conn2.release();

      // Wait for health check and recreation
      await new Promise(resolve => setTimeout(resolve, 150));

      const stats = pool.getStats();
      expect(stats.total).toBe(2); // Should maintain minimum size
      expect(connectionFactory.mock.calls.length).toBeGreaterThan(2);
    });
  });

  describe('Connection Lifecycle', () => {
    it('should call onDestroy when removing connection', async () => {
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize: 1,
        maxSize: 2,
        onCreate: onConnectionCreate,
        onDestroy: onConnectionDestroy
      });
      await pool.initialize();

      const conn = await pool.acquire();
      conn.connection.isHealthy = false;
      await conn.release();

      // Wait for health check
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(onConnectionDestroy).toHaveBeenCalledWith(
        expect.objectContaining({ id: conn.connection.id })
      );
      expect(conn.connection.close).toHaveBeenCalled();
    });

    it('should handle errors in lifecycle hooks', async () => {
      const errorCreate = jest.fn().mockRejectedValue(new Error('onCreate error'));
      const errorDestroy = jest.fn().mockRejectedValue(new Error('onDestroy error'));

      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize: 1,
        onCreate: errorCreate,
        onDestroy: errorDestroy
      });

      // Should not throw despite onCreate error
      await expect(pool.initialize()).resolves.not.toThrow();

      const conn = await pool.acquire();
      conn.connection.isHealthy = false;
      await conn.release();

      // Should handle onDestroy error gracefully
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(errorDestroy).toHaveBeenCalled();
    });
  });

  describe('Pool Statistics', () => {
    beforeEach(async () => {
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize: 2,
        maxSize: 5
      });
      await pool.initialize();
    });

    it('should track pool statistics accurately', async () => {
      let stats = pool.getStats();
      expect(stats).toEqual({
        total: 2,
        active: 0,
        idle: 2,
        waiting: 0,
        created: 2,
        destroyed: 0
      });

      const conn1 = await pool.acquire();
      stats = pool.getStats();
      expect(stats.active).toBe(1);
      expect(stats.idle).toBe(1);

      const conn2 = await pool.acquire();
      const conn3 = await pool.acquire();
      stats = pool.getStats();
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(3);
      expect(stats.idle).toBe(0);
      expect(stats.created).toBe(3);

      await conn1.release();
      stats = pool.getStats();
      expect(stats.active).toBe(2);
      expect(stats.idle).toBe(1);
    });

    it('should track destroyed connections', async () => {
      const conn = await pool.acquire();
      conn.connection.isHealthy = false;
      await conn.release();

      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = pool.getStats();
      expect(stats.destroyed).toBe(1);
    });
  });

  describe('Graceful Shutdown', () => {
    it('should close all connections on shutdown', async () => {
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize: 3,
        maxSize: 5
      });
      await pool.initialize();

      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();

      const initialStats = pool.getStats();
      expect(initialStats.total).toBe(3);

      await pool.shutdown();

      expect(conn1.connection.close).toHaveBeenCalled();
      expect(conn2.connection.close).toHaveBeenCalled();
      
      const finalStats = pool.getStats();
      expect(finalStats.total).toBe(0);
      expect(finalStats.active).toBe(0);
      expect(finalStats.idle).toBe(0);
    });

    it('should reject new acquisitions after shutdown', async () => {
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize: 1
      });
      await pool.initialize();

      await pool.shutdown();

      await expect(pool.acquire()).rejects.toThrow('Pool is shut down');
    });

    it('should cancel waiting requests on shutdown', async () => {
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize: 1,
        maxSize: 1
      });
      await pool.initialize();

      const conn = await pool.acquire();
      
      // Create waiting request
      const waitPromise = pool.acquire();

      // Shutdown should cancel waiting request
      await pool.shutdown();

      await expect(waitPromise).rejects.toThrow('Pool is shutting down');
    });
  });

  describe('Error Handling', () => {
    it('should handle connection factory errors', async () => {
      const errorFactory = jest.fn().mockRejectedValue(new Error('Factory error'));
      
      pool = new ConnectionPool({
        factory: errorFactory,
        healthCheck,
        minSize: 1
      });

      await expect(pool.initialize()).rejects.toThrow('Failed to create minimum connections');
    });

    it('should retry connection creation on transient errors', async () => {
      let attempts = 0;
      const flakeyFactory = jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Transient error');
        }
        return createMockConnection(`conn-${attempts}`);
      });

      pool = new ConnectionPool({
        factory: flakeyFactory,
        healthCheck,
        minSize: 1,
        maxRetries: 3
      });

      await pool.initialize();
      
      expect(flakeyFactory).toHaveBeenCalledTimes(3);
      const stats = pool.getStats();
      expect(stats.total).toBe(1);
    });

    it('should handle health check errors gracefully', async () => {
      const errorHealthCheck = jest.fn().mockRejectedValue(new Error('Health check error'));
      
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck: errorHealthCheck,
        minSize: 1,
        healthCheckInterval: 50
      });

      await pool.initialize();
      
      // Wait for health check
      await new Promise(resolve => setTimeout(resolve, 100));

      // Pool should still function despite health check errors
      const conn = await pool.acquire();
      expect(conn).toBeDefined();
    });
  });

  describe('Connection Validation', () => {
    it('should validate connection before returning from pool', async () => {
      const validateConnection = jest.fn().mockResolvedValue(true);
      
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        validateOnAcquire: validateConnection,
        minSize: 1
      });
      await pool.initialize();

      await pool.acquire();
      
      expect(validateConnection).toHaveBeenCalled();
    });

    it('should discard invalid connections and create new ones', async () => {
      const validateConnection = jest.fn()
        .mockResolvedValueOnce(false) // First connection invalid
        .mockResolvedValue(true);      // Subsequent connections valid
      
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        validateOnAcquire: validateConnection,
        minSize: 1,
        maxSize: 3
      });
      await pool.initialize();

      const conn = await pool.acquire();
      
      expect(validateConnection).toHaveBeenCalledTimes(2); // First failed, second succeeded
      expect(connectionFactory).toHaveBeenCalledTimes(2);  // Initial + replacement
      expect(conn).toBeDefined();
    });
  });

  describe('Pool Events', () => {
    it('should emit events for pool lifecycle', async () => {
      const events: Array<{ type: string; data: any }> = [];
      
      pool = new ConnectionPool({
        factory: connectionFactory,
        healthCheck,
        minSize: 1,
        maxSize: 2,
        onEvent: (type, data) => {
          events.push({ type, data });
        }
      });

      await pool.initialize();
      
      const conn = await pool.acquire();
      await conn.release();
      
      await pool.shutdown();

      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain('pool:initialized');
      expect(eventTypes).toContain('connection:created');
      expect(eventTypes).toContain('connection:acquired');
      expect(eventTypes).toContain('connection:released');
      expect(eventTypes).toContain('pool:shutdown');
    });
  });
});