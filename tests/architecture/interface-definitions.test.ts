/**
 * Interface Definitions Test Suite
 * 
 * This test suite drives the architecture simplification for Phase 16.
 * Tests enforce proper dependency injection, interface contracts, and substitutability.
 * 
 * The tests will fail initially as the InterfaceDefinitions module doesn't exist yet.
 * This follows TDD principles - write failing tests first, then implement.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { Config } from '../../src/config/index.js';

// These imports will fail initially - this is expected for TDD
import { 
  InterfaceDefinitions,
  type IStorageEngine,
  type IMonitoringSystem,
  type ICacheSystem,
  type IHookSystem,
  type ComponentFactory,
  type ImplementationConfig,
  type DependencyContainer
} from '../../src/architecture/interface-definitions.js';

describe('InterfaceDefinitions - Architecture Simplification', () => {
  let interfaceDefinitions: InterfaceDefinitions;
  let testConfig: Config;
  let mockContainer: DependencyContainer;

  beforeEach(() => {
    testConfig = {
      storage: {
        sqlite: { path: ':memory:', walMode: true, busyTimeout: 5000, cacheSize: 2000 },
        vector: { dimension: 384, path: './test-vectors', provider: 'hnswlib' },
        files: { path: './test-files', maxSize: 1024 * 1024 },
        limits: { maxMemorySize: '100MB', maxConcurrentOperations: 10 }
      },
      hooks: {
        execution: { timeout: 5000, maxMemory: '100MB', maxCpu: 1 },
        circuitBreaker: { failureThreshold: 5, resetTimeout: 60000, halfOpenRequests: 3 },
        sandbox: { enabled: true, allowedCommands: ['echo'], env: {} }
      },
      monitoring: {
        enabled: true,
        mode: 'simple',
        metrics: { enabled: true },
        healthCheck: { enabled: true, interval: 30000 },
        logging: { level: 'info' }
      },
      performance: {
        cache: { type: 'unified', maxSize: 1000, defaultTTL: 60000 }
      }
    };

    mockContainer = {
      register: jest.fn(),
      resolve: jest.fn(),
      registerSingleton: jest.fn(),
      isRegistered: jest.fn()
    };

    interfaceDefinitions = new InterfaceDefinitions(testConfig, mockContainer);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Dependency Injection Framework', () => {
    test('should provide dependency injection container', () => {
      // Given: A configured InterfaceDefinitions instance
      // When: Getting the dependency container
      const container = interfaceDefinitions.getContainer();
      
      // Then: Should return a valid container with injection methods
      expect(container).toBeDefined();
      expect(container.register).toBeDefined();
      expect(container.resolve).toBeDefined();
      expect(container.registerSingleton).toBeDefined();
      expect(container.isRegistered).toBeDefined();
    });

    test('should register storage engine implementations', async () => {
      // Given: Different storage engine implementations
      const implementations = ['sqlite', 'memory', 'mock'];
      
      // When: Registering each implementation
      for (const impl of implementations) {
        await interfaceDefinitions.registerStorageImplementation(impl);
      }
      
      // Then: All implementations should be registered
      expect(mockContainer.register).toHaveBeenCalledTimes(implementations.length);
      expect(mockContainer.register).toHaveBeenCalledWith('IStorageEngine', expect.any(Function), { name: 'sqlite' });
      expect(mockContainer.register).toHaveBeenCalledWith('IStorageEngine', expect.any(Function), { name: 'memory' });
      expect(mockContainer.register).toHaveBeenCalledWith('IStorageEngine', expect.any(Function), { name: 'mock' });
    });

    test('should register monitoring system implementations', async () => {
      // Given: Different monitoring implementations
      const implementations = ['simple', 'comprehensive', 'disabled'];
      
      // When: Registering each implementation
      for (const impl of implementations) {
        await interfaceDefinitions.registerMonitoringImplementation(impl);
      }
      
      // Then: All implementations should be registered
      expect(mockContainer.register).toHaveBeenCalledTimes(implementations.length);
      expect(mockContainer.register).toHaveBeenCalledWith('IMonitoringSystem', expect.any(Function), { name: 'simple' });
      expect(mockContainer.register).toHaveBeenCalledWith('IMonitoringSystem', expect.any(Function), { name: 'comprehensive' });
      expect(mockContainer.register).toHaveBeenCalledWith('IMonitoringSystem', expect.any(Function), { name: 'disabled' });
    });

    test('should register cache system implementations', async () => {
      // Given: Different cache implementations
      const implementations = ['unified', 'multi-level', 'no-cache'];
      
      // When: Registering each implementation
      for (const impl of implementations) {
        await interfaceDefinitions.registerCacheImplementation(impl);
      }
      
      // Then: All implementations should be registered
      expect(mockContainer.register).toHaveBeenCalledTimes(implementations.length);
      expect(mockContainer.register).toHaveBeenCalledWith('ICacheSystem', expect.any(Function), { name: 'unified' });
      expect(mockContainer.register).toHaveBeenCalledWith('ICacheSystem', expect.any(Function), { name: 'multi-level' });
      expect(mockContainer.register).toHaveBeenCalledWith('ICacheSystem', expect.any(Function), { name: 'no-cache' });
    });

    test('should register hook system implementations', async () => {
      // Given: Different hook implementations
      const implementations = ['production', 'mock', 'test'];
      
      // When: Registering each implementation
      for (const impl of implementations) {
        await interfaceDefinitions.registerHookImplementation(impl);
      }
      
      // Then: All implementations should be registered
      expect(mockContainer.register).toHaveBeenCalledTimes(implementations.length);
      expect(mockContainer.register).toHaveBeenCalledWith('IHookSystem', expect.any(Function), { name: 'production' });
      expect(mockContainer.register).toHaveBeenCalledWith('IHookSystem', expect.any(Function), { name: 'mock' });
      expect(mockContainer.register).toHaveBeenCalledWith('IHookSystem', expect.any(Function), { name: 'test' });
    });
  });

  describe('Interface Contracts - Storage Engine', () => {
    test('IStorageEngine should enforce consistent method signatures', async () => {
      // Given: Different storage engine implementations
      const sqliteEngine = await interfaceDefinitions.createStorageEngine('sqlite');
      const memoryEngine = await interfaceDefinitions.createStorageEngine('memory');
      const mockEngine = await interfaceDefinitions.createStorageEngine('mock');
      
      // When: Checking method signatures
      const engines = [sqliteEngine, memoryEngine, mockEngine];
      
      // Then: All implementations should have consistent interfaces
      for (const engine of engines) {
        expect(typeof engine.initialize).toBe('function');
        expect(typeof engine.captureMemory).toBe('function');
        expect(typeof engine.queryMemories).toBe('function');
        expect(typeof engine.getStatistics).toBe('function');
        expect(typeof engine.close).toBe('function');
        
        // Method arity should be consistent
        expect(engine.captureMemory.length).toBe(1); // One parameter: memory without id
        expect(engine.queryMemories.length).toBe(1); // One parameter: filters object
        expect(engine.getStatistics.length).toBe(0); // No parameters
      }
    });

    test('IStorageEngine should maintain async/sync compatibility', async () => {
      // Given: A storage engine implementation
      const engine = await interfaceDefinitions.createStorageEngine('sqlite');
      
      // When: Calling async methods
      const initPromise = engine.initialize();
      const statsPromise = engine.getStatistics();
      const closePromise = engine.close();
      
      // Then: All methods should return promises
      expect(initPromise).toBeInstanceOf(Promise);
      expect(statsPromise).toBeInstanceOf(Promise);
      expect(closePromise).toBeInstanceOf(Promise);
      
      // And promises should resolve properly
      await expect(initPromise).resolves.toBeUndefined();
      await expect(statsPromise).resolves.toEqual(expect.any(Object));
      await expect(closePromise).resolves.toBeUndefined();
    });

    test('IStorageEngine should handle error conditions consistently', async () => {
      // Given: Storage engines with error conditions
      const engines = [
        await interfaceDefinitions.createStorageEngine('sqlite'),
        await interfaceDefinitions.createStorageEngine('memory'),
        await interfaceDefinitions.createStorageEngine('mock')
      ];
      
      // When: Operating on uninitialized engines
      for (const engine of engines) {
        // Then: Should throw consistent errors
        await expect(engine.captureMemory({
          eventType: 'test',
          content: 'test content',
          timestamp: new Date(),
          sessionId: 'test-session'
        })).rejects.toThrow('not initialized');
        
        await expect(engine.queryMemories()).rejects.toThrow('not initialized');
        await expect(engine.getStatistics()).rejects.toThrow('not initialized');
      }
    });
  });

  describe('Interface Contracts - Monitoring System', () => {
    test('IMonitoringSystem should enforce consistent method signatures', async () => {
      // Given: Different monitoring implementations
      const simpleMonitor = await interfaceDefinitions.createMonitoringSystem('simple');
      const comprehensiveMonitor = await interfaceDefinitions.createMonitoringSystem('comprehensive');
      const disabledMonitor = await interfaceDefinitions.createMonitoringSystem('disabled');
      
      // When: Checking method signatures
      const monitors = [simpleMonitor, comprehensiveMonitor, disabledMonitor];
      
      // Then: All implementations should have consistent interfaces
      for (const monitor of monitors) {
        expect(typeof monitor.initialize).toBe('function');
        expect(typeof monitor.getMetrics).toBe('function');
        expect(typeof monitor.getHealthStatus).toBe('function');
        expect(typeof monitor.startTimer).toBe('function');
        expect(typeof monitor.incrementOperationCount).toBe('function');
        expect(typeof monitor.shutdown).toBe('function');
        
        // Method arity should be consistent
        expect(monitor.startTimer.length).toBe(1); // One parameter: operation type
        expect(monitor.incrementOperationCount.length).toBe(1); // One parameter: operation type
      }
    });

    test('IMonitoringSystem should provide timer interface consistently', async () => {
      // Given: Different monitoring implementations
      const monitors = [
        await interfaceDefinitions.createMonitoringSystem('simple'),
        await interfaceDefinitions.createMonitoringSystem('comprehensive')
      ];
      
      // When: Starting timers
      for (const monitor of monitors) {
        await monitor.initialize();
        const timer = monitor.startTimer('test_operation');
        
        // Then: Timer should have consistent interface
        expect(timer).toBeDefined();
        expect(typeof timer.end).toBe('function');
        expect(timer.end.length).toBe(0); // No parameters
        
        // Timer should return numeric duration
        const duration = timer.end();
        expect(typeof duration).toBe('number');
        expect(duration).toBeGreaterThanOrEqual(0);
        
        await monitor.shutdown();
      }
    });

    test('IMonitoringSystem should handle disabled state gracefully', async () => {
      // Given: A disabled monitoring system
      const disabledMonitor = await interfaceDefinitions.createMonitoringSystem('disabled');
      
      // When: Calling monitoring methods
      await disabledMonitor.initialize();
      
      // Then: Should handle calls gracefully without errors
      expect(() => disabledMonitor.incrementOperationCount('test')).not.toThrow();
      
      const timer = disabledMonitor.startTimer('test');
      expect(timer).toBeDefined();
      expect(typeof timer.end()).toBe('number');
      
      const metrics = await disabledMonitor.getMetrics();
      expect(metrics).toBeDefined();
      
      const health = await disabledMonitor.getHealthStatus();
      expect(health).toBeDefined();
      expect(health.status).toBe('alive');
      
      await disabledMonitor.shutdown();
    });
  });

  describe('Interface Contracts - Cache System', () => {
    test('ICacheSystem should enforce consistent method signatures', async () => {
      // Given: Different cache implementations
      const unifiedCache = await interfaceDefinitions.createCacheSystem('unified');
      const multiLevelCache = await interfaceDefinitions.createCacheSystem('multi-level');
      const noCache = await interfaceDefinitions.createCacheSystem('no-cache');
      
      // When: Checking method signatures
      const caches = [unifiedCache, multiLevelCache, noCache];
      
      // Then: All implementations should have consistent interfaces
      for (const cache of caches) {
        expect(typeof cache.get).toBe('function');
        expect(typeof cache.set).toBe('function');
        expect(typeof cache.delete).toBe('function');
        expect(typeof cache.clear).toBe('function');
        expect(typeof cache.has).toBe('function');
        expect(typeof cache.size).toBe('function');
        expect(typeof cache.keys).toBe('function');
        
        // Method arity should be consistent
        expect(cache.get.length).toBe(1); // One parameter: key
        expect(cache.set.length).toBe(3); // Three parameters: key, value, ttl (optional)
        expect(cache.delete.length).toBe(1); // One parameter: key
        expect(cache.has.length).toBe(1); // One parameter: key
      }
    });

    test('ICacheSystem should maintain async interface consistency', async () => {
      // Given: Cache implementations
      const caches = [
        await interfaceDefinitions.createCacheSystem('unified'),
        await interfaceDefinitions.createCacheSystem('multi-level'),
        await interfaceDefinitions.createCacheSystem('no-cache')
      ];
      
      // When: Calling cache methods
      for (const cache of caches) {
        const testKey = 'test-key';
        const testValue = 'test-value';
        
        // Then: All methods should return promises
        expect(cache.set(testKey, testValue)).toBeInstanceOf(Promise);
        expect(cache.get(testKey)).toBeInstanceOf(Promise);
        expect(cache.has(testKey)).toBeInstanceOf(Promise);
        expect(cache.delete(testKey)).toBeInstanceOf(Promise);
        expect(cache.clear()).toBeInstanceOf(Promise);
        expect(cache.size()).toBeInstanceOf(Promise);
        expect(cache.keys()).toBeInstanceOf(Promise);
        
        // And should resolve properly
        await cache.set(testKey, testValue);
        const value = await cache.get(testKey);
        const exists = await cache.has(testKey);
        const cacheSize = await cache.size();
        const cacheKeys = await cache.keys();
        
        expect(typeof exists).toBe('boolean');
        expect(typeof cacheSize).toBe('number');
        expect(Array.isArray(cacheKeys)).toBe(true);
        
        await cache.clear();
      }
    });

    test('ICacheSystem should handle no-cache implementation gracefully', async () => {
      // Given: A no-cache implementation
      const noCache = await interfaceDefinitions.createCacheSystem('no-cache');
      
      // When: Performing cache operations
      await noCache.set('key1', 'value1');
      const value = await noCache.get('key1');
      const exists = await noCache.has('key1');
      const size = await noCache.size();
      
      // Then: Should behave like a cache that never stores
      expect(value).toBeUndefined();
      expect(exists).toBe(false);
      expect(size).toBe(0);
      
      // Should not throw errors
      await expect(noCache.delete('key1')).resolves.toBeUndefined();
      await expect(noCache.clear()).resolves.toBeUndefined();
      await expect(noCache.keys()).resolves.toEqual([]);
    });
  });

  describe('Interface Contracts - Hook System', () => {
    test('IHookSystem should enforce consistent method signatures', async () => {
      // Given: Different hook implementations
      const productionHooks = await interfaceDefinitions.createHookSystem('production');
      const mockHooks = await interfaceDefinitions.createHookSystem('mock');
      const testHooks = await interfaceDefinitions.createHookSystem('test');
      
      // When: Checking method signatures
      const hookSystems = [productionHooks, mockHooks, testHooks];
      
      // Then: All implementations should have consistent interfaces
      for (const hooks of hookSystems) {
        expect(typeof hooks.initialize).toBe('function');
        expect(typeof hooks.executeHook).toBe('function');
        expect(typeof hooks.close).toBe('function');
        
        // Method arity should be consistent
        expect(hooks.executeHook.length).toBe(1); // One parameter: hook event
      }
    });

    test('IHookSystem should handle hook execution consistently', async () => {
      // Given: Different hook implementations
      const hookSystems = [
        await interfaceDefinitions.createHookSystem('production'),
        await interfaceDefinitions.createHookSystem('mock'),
        await interfaceDefinitions.createHookSystem('test')
      ];
      
      // When: Executing hooks
      for (const hooks of hookSystems) {
        hooks.initialize();
        
        const hookEvent = {
          type: 'test-event',
          tool: 'test-tool',
          data: { input: 'test' },
          timestamp: new Date()
        };
        
        const result = await hooks.executeHook(hookEvent);
        
        // Then: Result should have consistent structure
        if (result !== null) {
          expect(typeof result).toBe('object');
          // Result can have output, error, exitCode, skipped, reason properties
          if ('output' in result) expect(typeof result.output).toBe('string');
          if ('error' in result) expect(typeof result.error).toBe('string');
          if ('exitCode' in result) expect(typeof result.exitCode).toBe('number');
          if ('skipped' in result) expect(typeof result.skipped).toBe('boolean');
          if ('reason' in result) expect(typeof result.reason).toBe('string');
        }
        
        hooks.close();
      }
    });

    test('IHookSystem should handle mock implementation predictably', async () => {
      // Given: A mock hook system
      const mockHooks = await interfaceDefinitions.createHookSystem('mock');
      
      // When: Executing hooks
      mockHooks.initialize();
      
      const hookEvent = {
        type: 'test-event',
        tool: 'test-tool',
        data: { input: 'test' },
        timestamp: new Date()
      };
      
      const result = await mockHooks.executeHook(hookEvent);
      
      // Then: Should return predictable mock result
      expect(result).toBeDefined();
      expect(result).toEqual(expect.objectContaining({
        output: expect.any(String),
        exitCode: 0
      }));
      
      mockHooks.close();
    });
  });

  describe('Substitutability (Liskov Substitution Principle)', () => {
    test('should allow runtime switching between storage implementations', async () => {
      // Given: Different storage engine implementations
      const implementations = ['sqlite', 'memory', 'mock'];
      
      // When: Switching between implementations at runtime
      for (const impl of implementations) {
        const engine = await interfaceDefinitions.createStorageEngine(impl);
        
        // Then: Should be able to use any implementation interchangeably
        await engine.initialize();
        
        const memory = await engine.captureMemory({
          eventType: 'test',
          content: 'test content',
          timestamp: new Date(),
          sessionId: 'test-session'
        });
        
        expect(memory).toBeDefined();
        expect(memory.id).toBeDefined();
        
        const memories = await engine.queryMemories({ sessionId: 'test-session' });
        expect(Array.isArray(memories)).toBe(true);
        
        const stats = await engine.getStatistics();
        expect(stats).toBeDefined();
        expect(typeof stats.totalMemories).toBe('number');
        
        await engine.close();
      }
    });

    test('should allow runtime switching between monitoring implementations', async () => {
      // Given: Different monitoring implementations
      const implementations = ['simple', 'comprehensive', 'disabled'];
      
      // When: Switching between implementations at runtime
      for (const impl of implementations) {
        const monitor = await interfaceDefinitions.createMonitoringSystem(impl);
        
        // Then: Should be able to use any implementation interchangeably
        await monitor.initialize();
        
        // Should handle operation tracking
        monitor.incrementOperationCount('test_op');
        
        const timer = monitor.startTimer('test_timer');
        const duration = timer.end();
        expect(typeof duration).toBe('number');
        
        // Should provide metrics
        const metrics = await monitor.getMetrics();
        expect(metrics).toBeDefined();
        
        // Should provide health status
        const health = await monitor.getHealthStatus();
        expect(health).toBeDefined();
        expect(['alive', 'dead']).toContain(health.status);
        
        await monitor.shutdown();
      }
    });

    test('should allow runtime switching between cache implementations', async () => {
      // Given: Different cache implementations
      const implementations = ['unified', 'multi-level', 'no-cache'];
      
      // When: Switching between implementations at runtime
      for (const impl of implementations) {
        const cache = await interfaceDefinitions.createCacheSystem(impl);
        
        // Then: Should be able to use any implementation interchangeably
        await cache.set('test-key', 'test-value');
        
        // No-cache will return undefined, others should return the value
        const value = await cache.get('test-key');
        if (impl === 'no-cache') {
          expect(value).toBeUndefined();
        } else {
          expect(value).toBe('test-value');
        }
        
        // All should handle existence checks
        const exists = await cache.has('test-key');
        expect(typeof exists).toBe('boolean');
        
        // All should handle size queries
        const size = await cache.size();
        expect(typeof size).toBe('number');
        
        await cache.clear();
      }
    });

    test('should support feature detection and graceful degradation', async () => {
      // Given: Components with different feature sets
      const storageEngine = await interfaceDefinitions.createStorageEngine('mock');
      const monitor = await interfaceDefinitions.createMonitoringSystem('disabled');
      const cache = await interfaceDefinitions.createCacheSystem('no-cache');
      
      // When: Checking for optional features
      const storageFeatures = interfaceDefinitions.getStorageFeatures('mock');
      const monitoringFeatures = interfaceDefinitions.getMonitoringFeatures('disabled');
      const cacheFeatures = interfaceDefinitions.getCacheFeatures('no-cache');
      
      // Then: Should provide feature detection
      expect(storageFeatures).toBeDefined();
      expect(storageFeatures.hasVectorSearch).toBe(false); // Mock doesn't support vector search
      expect(storageFeatures.hasFileStorage).toBe(false); // Mock doesn't support file storage
      
      expect(monitoringFeatures).toBeDefined();
      expect(monitoringFeatures.hasMetrics).toBe(false); // Disabled monitor has no metrics
      expect(monitoringFeatures.hasTracing).toBe(false); // Disabled monitor has no tracing
      
      expect(cacheFeatures).toBeDefined();
      expect(cacheFeatures.hasPersistence).toBe(false); // No-cache has no persistence
      expect(cacheFeatures.hasEviction).toBe(false); // No-cache has no eviction
    });
  });

  describe('Factory Pattern Implementation', () => {
    test('should provide ComponentFactory for creating implementations', () => {
      // Given: Interface definitions with factory
      const factory = interfaceDefinitions.getFactory();
      
      // When: Checking factory interface
      // Then: Should have factory methods for all component types
      expect(typeof factory.createStorageEngine).toBe('function');
      expect(typeof factory.createMonitoringSystem).toBe('function');
      expect(typeof factory.createCacheSystem).toBe('function');
      expect(typeof factory.createHookSystem).toBe('function');
    });

    test('should support factory registration of custom implementations', async () => {
      // Given: A custom storage implementation
      const customStorage: IStorageEngine = {
        initialize: jest.fn().mockResolvedValue(undefined),
        captureMemory: jest.fn().mockResolvedValue({ id: 'custom-1', eventType: 'test', content: 'test', timestamp: new Date(), sessionId: 'test' }),
        queryMemories: jest.fn().mockResolvedValue([]),
        getStatistics: jest.fn().mockResolvedValue({ totalMemories: 0, totalSize: 0, memoriesByType: {} }),
        close: jest.fn().mockResolvedValue(undefined)
      };
      
      // When: Registering custom implementation
      const factory = interfaceDefinitions.getFactory();
      factory.registerStorageImplementation('custom', () => customStorage);
      
      // Then: Should be able to create custom implementation
      const engine = await interfaceDefinitions.createStorageEngine('custom');
      expect(engine).toBe(customStorage);
      
      // And should work like any other implementation
      await engine.initialize();
      const memory = await engine.captureMemory({
        eventType: 'test',
        content: 'test',
        timestamp: new Date(),
        sessionId: 'test'
      });
      expect(memory.id).toBe('custom-1');
    });

    test('should support factory validation of implementations', async () => {
      // Given: An invalid implementation (missing required methods)
      const invalidStorage = {
        initialize: jest.fn(),
        // Missing captureMemory, queryMemories, getStatistics, close
      };
      
      // When: Registering invalid implementation
      const factory = interfaceDefinitions.getFactory();
      
      // Then: Should throw validation error
      expect(() => {
        factory.registerStorageImplementation('invalid', () => invalidStorage as any);
      }).toThrow('Implementation does not satisfy IStorageEngine interface');
    });
  });

  describe('Configuration-Driven Component Selection', () => {
    test('should create components based on configuration', async () => {
      // Given: Different configurations
      const configs: ImplementationConfig[] = [
        {
          storage: 'sqlite',
          monitoring: 'simple',
          cache: 'unified',
          hooks: 'production'
        },
        {
          storage: 'memory',
          monitoring: 'comprehensive',
          cache: 'multi-level',
          hooks: 'mock'
        },
        {
          storage: 'mock',
          monitoring: 'disabled',
          cache: 'no-cache',
          hooks: 'test'
        }
      ];
      
      // When: Creating components from configuration
      for (const config of configs) {
        const components = await interfaceDefinitions.createFromConfig(config);
        
        // Then: Should create correct implementations
        expect(components.storage).toBeDefined();
        expect(components.monitoring).toBeDefined();
        expect(components.cache).toBeDefined();
        expect(components.hooks).toBeDefined();
        
        // Should be able to use components interchangeably
        await components.storage.initialize();
        await components.monitoring.initialize();
        
        // Test basic operations
        await components.cache.set('test', 'value');
        const cached = await components.cache.get('test');
        
        components.hooks.initialize();
        const hookResult = await components.hooks.executeHook({
          type: 'test',
          data: {},
          timestamp: new Date()
        });
        
        // Cleanup
        await components.storage.close();
        await components.monitoring.shutdown();
        await components.cache.clear();
        components.hooks.close();
      }
    });

    test('should validate configuration before creating components', async () => {
      // Given: Invalid configurations
      const invalidConfigs = [
        { storage: 'nonexistent', monitoring: 'simple', cache: 'unified', hooks: 'production' },
        { storage: 'sqlite', monitoring: 'nonexistent', cache: 'unified', hooks: 'production' },
        { storage: 'sqlite', monitoring: 'simple', cache: 'nonexistent', hooks: 'production' },
        { storage: 'sqlite', monitoring: 'simple', cache: 'unified', hooks: 'nonexistent' }
      ];
      
      // When: Creating components from invalid configuration
      for (const config of invalidConfigs) {
        // Then: Should throw configuration error
        await expect(interfaceDefinitions.createFromConfig(config)).rejects.toThrow('Unknown implementation');
      }
    });

    test('should support environment-based configuration', async () => {
      // Given: Environment variables
      process.env.STORAGE_IMPLEMENTATION = 'memory';
      process.env.MONITORING_IMPLEMENTATION = 'simple';
      process.env.CACHE_IMPLEMENTATION = 'unified';
      process.env.HOOKS_IMPLEMENTATION = 'mock';
      
      try {
        // When: Creating components from environment
        const components = await interfaceDefinitions.createFromEnvironment();
        
        // Then: Should create components based on environment
        expect(components.storage).toBeDefined();
        expect(components.monitoring).toBeDefined();
        expect(components.cache).toBeDefined();
        expect(components.hooks).toBeDefined();
        
        // Should be functional
        await components.storage.initialize();
        await components.monitoring.initialize();
        
        // Cleanup
        await components.storage.close();
        await components.monitoring.shutdown();
      } finally {
        // Cleanup environment
        delete process.env.STORAGE_IMPLEMENTATION;
        delete process.env.MONITORING_IMPLEMENTATION;
        delete process.env.CACHE_IMPLEMENTATION;
        delete process.env.HOOKS_IMPLEMENTATION;
      }
    });
  });

  describe('Integration Testing with Different Implementations', () => {
    test('should work with SQLite storage + SimpleMonitor + UnifiedCache + ProductionHooks', async () => {
      // Given: Production-like configuration
      const config: ImplementationConfig = {
        storage: 'sqlite',
        monitoring: 'simple',
        cache: 'unified',
        hooks: 'production'
      };
      
      // When: Creating and using components
      const components = await interfaceDefinitions.createFromConfig(config);
      await components.storage.initialize();
      await components.monitoring.initialize();
      components.hooks.initialize();
      
      // Then: Should work together seamlessly
      const timer = components.monitoring.startTimer('memory_capture');
      
      const memory = await components.storage.captureMemory({
        eventType: 'test',
        content: 'integration test',
        timestamp: new Date(),
        sessionId: 'integration-session'
      });
      
      const duration = timer.end();
      expect(duration).toBeGreaterThan(0);
      
      await components.cache.set(`memory:${memory.id}`, memory);
      const cached = await components.cache.get(`memory:${memory.id}`);
      expect(cached).toEqual(memory);
      
      const hookResult = await components.hooks.executeHook({
        type: 'memory_captured',
        data: { memoryId: memory.id },
        timestamp: new Date()
      });
      
      // Cleanup
      await components.storage.close();
      await components.monitoring.shutdown();
      await components.cache.clear();
      components.hooks.close();
    });

    test('should work with Memory storage + DisabledMonitor + NoCache + MockHooks', async () => {
      // Given: Minimal/test configuration
      const config: ImplementationConfig = {
        storage: 'memory',
        monitoring: 'disabled',
        cache: 'no-cache',
        hooks: 'mock'
      };
      
      // When: Creating and using components
      const components = await interfaceDefinitions.createFromConfig(config);
      await components.storage.initialize();
      await components.monitoring.initialize();
      components.hooks.initialize();
      
      // Then: Should work together with minimal overhead
      components.monitoring.incrementOperationCount('test');
      
      const memory = await components.storage.captureMemory({
        eventType: 'test',
        content: 'minimal test',
        timestamp: new Date(),
        sessionId: 'minimal-session'
      });
      
      // Cache won't store, but shouldn't error
      await components.cache.set(`memory:${memory.id}`, memory);
      const cached = await components.cache.get(`memory:${memory.id}`);
      expect(cached).toBeUndefined(); // No-cache returns undefined
      
      // Mock hooks return predictable results
      const hookResult = await components.hooks.executeHook({
        type: 'test',
        data: {},
        timestamp: new Date()
      });
      expect(hookResult).toBeDefined();
      
      // Cleanup
      await components.storage.close();
      await components.monitoring.shutdown();
      components.hooks.close();
    });

    test('should handle mixed implementation scenarios', async () => {
      // Given: Mixed configuration (production storage + test monitoring)
      const config: ImplementationConfig = {
        storage: 'sqlite',
        monitoring: 'disabled',
        cache: 'multi-level',
        hooks: 'test'
      };
      
      // When: Creating and using components
      const components = await interfaceDefinitions.createFromConfig(config);
      await components.storage.initialize();
      await components.monitoring.initialize();
      components.hooks.initialize();
      
      // Then: Should work with mixed implementations
      const memories = [];
      for (let i = 0; i < 5; i++) {
        const memory = await components.storage.captureMemory({
          eventType: 'test',
          content: `test content ${i}`,
          timestamp: new Date(),
          sessionId: 'mixed-session'
        });
        memories.push(memory);
        
        // Cache should work with multi-level
        await components.cache.set(`memory:${i}`, memory);
      }
      
      // Verify cached items
      for (let i = 0; i < 5; i++) {
        const cached = await components.cache.get(`memory:${i}`);
        expect(cached).toEqual(memories[i]);
      }
      
      // Query should work
      const queried = await components.storage.queryMemories({ sessionId: 'mixed-session' });
      expect(queried).toHaveLength(5);
      
      // Cleanup
      await components.storage.close();
      await components.monitoring.shutdown();
      await components.cache.clear();
      components.hooks.close();
    });
  });
});