import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { VectorStore } from "../../src/storage/vector-store.js";
import fs from "fs";
import path from "path";

describe('VectorStore - Constraints and Automatic Pruning', () => {
  let store: VectorStore;
  const testPath = path.join(process.cwd(), '.test-memory', 'vector-constraints-test');
  
  beforeEach(async () => {
    // Clean up any existing test directory
    if (fs.existsSync(testPath)) {
      fs.rmSync(testPath, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    // Clean up after tests
    if (store) {
      await store.close();
    }
    if (fs.existsSync(testPath)) {
      fs.rmSync(testPath, { recursive: true, force: true });
    }
  });

  describe('Maximum Vector Limits Enforcement', () => {
    it('should enforce maximum vector count constraint', async () => {
      // Given: Vector store with maximum vector limit
      store = new VectorStore({ 
        dimension: 3, 
        path: testPath,
        maxVectors: 5 
      });
      await store.initialize();
      
      // When: Adding vectors up to the limit
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const id = await store.store([i, i, i], { index: i });
        ids.push(id);
      }
      
      // Then: Should allow vectors up to limit
      const metrics = store.getMetrics();
      expect(metrics.storage.vectorCount).toBe(5);
      
      // When: Attempting to add beyond limit
      const beyondLimitPromise = store.store([6, 6, 6], { index: 6 });
      
      // Then: Should enforce constraint
      await expect(beyondLimitPromise).rejects.toThrow('Maximum vector limit of 5 exceeded');
    });

    it('should respect workspace-specific vector limits', async () => {
      // Given: Vector store with workspace-specific limits
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        maxVectorsPerWorkspace: 3,
        workspaceIsolation: true
      });
      await store.initialize();
      
      // When: Adding vectors to different workspaces
      await store.store([1, 1, 1], { workspaceId: 'workspace1', type: 'test' });
      await store.store([2, 2, 2], { workspaceId: 'workspace1', type: 'test' });
      await store.store([3, 3, 3], { workspaceId: 'workspace1', type: 'test' });
      
      await store.store([1, 1, 1], { workspaceId: 'workspace2', type: 'test' });
      await store.store([2, 2, 2], { workspaceId: 'workspace2', type: 'test' });
      
      // Then: Should allow vectors in different workspaces
      const workspace1Count = await store.getWorkspaceVectorCount('workspace1');
      const workspace2Count = await store.getWorkspaceVectorCount('workspace2');
      expect(workspace1Count).toBe(3);
      expect(workspace2Count).toBe(2);
      
      // When: Attempting to exceed workspace limit
      const exceedPromise = store.store([4, 4, 4], { workspaceId: 'workspace1', type: 'test' });
      
      // Then: Should enforce workspace-specific constraint
      await expect(exceedPromise).rejects.toThrow('Maximum vectors per workspace (3) exceeded for workspace1');
    });

    it('should handle memory usage constraints', async () => {
      // Given: Vector store with memory limit
      store = new VectorStore({ 
        dimension: 1000, // Large vectors
        path: testPath,
        maxMemoryMB: 1, // 1MB limit
        memoryConstraintMode: 'strict'
      });
      await store.initialize();
      
      // When: Adding vectors that approach memory limit
      const largeVector = new Array(1000).fill(0.5);
      await store.store(largeVector, { type: 'large' });
      
      // Then: Should track memory usage
      const memoryUsage = store.getMemoryUsage();
      expect(memoryUsage.currentMB).toBeGreaterThan(0);
      expect(memoryUsage.limitMB).toBe(1);
      
      // When: Attempting to exceed memory limit
      const exceedMemoryPromise = store.store(largeVector, { type: 'exceed' });
      
      // Then: Should enforce memory constraint
      await expect(exceedMemoryPromise).rejects.toThrow(/Memory limit of 1MB would be exceeded/);
    });

    it('should provide constraint validation before storage', async () => {
      // Given: Vector store with multiple constraints
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        maxVectors: 10,
        maxMemoryMB: 5,
        validateConstraints: true
      });
      await store.initialize();
      
      // When: Validating constraint compliance
      const validation = await store.validateConstraints({
        vector: [1, 2, 3],
        metadata: { type: 'test' }
      });
      
      // Then: Should return validation result
      expect(validation.canStore).toBe(true);
      expect(validation.constraints).toBeDefined();
      expect(validation.constraints.vectorCount.current).toBe(0);
      expect(validation.constraints.vectorCount.limit).toBe(10);
      expect(validation.constraints.memory.currentMB).toBeDefined();
      expect(validation.constraints.memory.limitMB).toBe(5);
    });
  });

  describe('Automatic Pruning When Limits Reached', () => {
    it('should automatically prune oldest vectors when limit reached', async () => {
      // Given: Vector store with pruning enabled
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        maxVectors: 3,
        enableAutoPruning: true,
        pruningStrategy: 'fifo' // First In, First Out
      });
      await store.initialize();
      
      // When: Adding vectors beyond limit
      const id1 = await store.store([1, 1, 1], { timestamp: Date.now() - 3000, type: 'old' });
      await new Promise(resolve => setTimeout(resolve, 10)); // Ensure different timestamps
      const id2 = await store.store([2, 2, 2], { timestamp: Date.now() - 2000, type: 'medium' });
      await new Promise(resolve => setTimeout(resolve, 10));
      const id3 = await store.store([3, 3, 3], { timestamp: Date.now() - 1000, type: 'recent' });
      
      // Store should be at capacity
      expect(store.getMetrics().storage.vectorCount).toBe(3);
      
      // When: Adding one more vector (should trigger pruning)
      const id4 = await store.store([4, 4, 4], { timestamp: Date.now(), type: 'newest' });
      
      // Then: Should have pruned oldest vector
      expect(store.getMetrics().storage.vectorCount).toBe(3);
      expect(await store.get(id1)).toBeNull(); // Oldest should be removed
      expect(await store.get(id2)).not.toBeNull();
      expect(await store.get(id3)).not.toBeNull();
      expect(await store.get(id4)).not.toBeNull(); // Newest should be present
    });

    it('should prune based on access frequency (LRU strategy)', async () => {
      // Given: Vector store with LRU pruning
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        maxVectors: 3,
        enableAutoPruning: true,
        pruningStrategy: 'lru' // Least Recently Used
      });
      await store.initialize();
      
      // When: Adding vectors and accessing them
      const id1 = await store.store([1, 1, 1], { type: 'vector1' });
      const id2 = await store.store([2, 2, 2], { type: 'vector2' });
      const id3 = await store.store([3, 3, 3], { type: 'vector3' });
      
      // Access vectors to establish usage pattern
      await store.get(id1); // Most recent access
      await store.get(id3); // Second most recent
      // id2 is least recently used
      
      // When: Adding vector that triggers pruning
      const id4 = await store.store([4, 4, 4], { type: 'vector4' });
      
      // Then: Should have pruned least recently used vector (id2)
      expect(store.getMetrics().storage.vectorCount).toBe(3);
      expect(await store.get(id1)).not.toBeNull(); // Recently accessed
      expect(await store.get(id2)).toBeNull(); // LRU - should be removed
      expect(await store.get(id3)).not.toBeNull(); // Recently accessed
      expect(await store.get(id4)).not.toBeNull(); // Newly added
    });

    it('should support priority-based pruning strategy', async () => {
      // Given: Vector store with priority-based pruning
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        maxVectors: 3,
        enableAutoPruning: true,
        pruningStrategy: 'priority',
        priorityField: 'importance'
      });
      await store.initialize();
      
      // When: Adding vectors with different priorities
      const lowId = await store.store([1, 1, 1], { importance: 1, type: 'low' });
      const highId = await store.store([2, 2, 2], { importance: 10, type: 'high' });
      const mediumId = await store.store([3, 3, 3], { importance: 5, type: 'medium' });
      
      // When: Adding vector that triggers pruning
      const newHighId = await store.store([4, 4, 4], { importance: 8, type: 'new-high' });
      
      // Then: Should have pruned lowest priority vector
      expect(store.getMetrics().storage.vectorCount).toBe(3);
      expect(await store.get(lowId)).toBeNull(); // Lowest priority - removed
      expect(await store.get(highId)).not.toBeNull(); // Highest priority - kept
      expect(await store.get(mediumId)).not.toBeNull(); // Medium priority - kept
      expect(await store.get(newHighId)).not.toBeNull(); // New high priority - added
    });

    it('should support batch pruning with configurable threshold', async () => {
      // Given: Vector store with batch pruning
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        maxVectors: 10,
        enableAutoPruning: true,
        pruningStrategy: 'fifo',
        batchPruning: true,
        pruningBatchSize: 3, // Prune 3 at a time
        pruningThreshold: 0.9 // Start pruning at 90% capacity
      });
      await store.initialize();
      
      // When: Adding vectors up to threshold (9 vectors = 90% of 10)
      for (let i = 0; i < 9; i++) {
        await store.store([i, i, i], { index: i, timestamp: Date.now() + i });
      }
      
      expect(store.getMetrics().storage.vectorCount).toBe(9);
      
      // When: Adding one more vector (triggers batch pruning)
      await store.store([9, 9, 9], { index: 9, timestamp: Date.now() + 9 });
      
      // Then: Should have pruned batch of 3 oldest vectors
      const finalCount = store.getMetrics().storage.vectorCount;
      expect(finalCount).toBe(7); // 10 - 3 (batch pruned) = 7
      
      // Verify oldest vectors were removed
      expect(await store.get('vec_0')).toBeNull();
      expect(await store.get('vec_1')).toBeNull();
      expect(await store.get('vec_2')).toBeNull();
    });
  });

  describe('Pruning Strategy Configuration', () => {
    it('should support custom pruning strategies', async () => {
      // Given: Vector store with custom pruning strategy
      const customPruningStrategy = {
        name: 'custom',
        selectForPruning: (vectors: any[], count: number) => {
          // Custom logic: remove vectors with even indices
          return vectors
            .filter((v, i) => i % 2 === 0)
            .slice(0, count)
            .map(v => v.id);
        }
      };
      
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        maxVectors: 4,
        enableAutoPruning: true,
        customPruningStrategy
      });
      await store.initialize();
      
      // When: Adding vectors to trigger custom pruning
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) {
        const id = await store.store([i, i, i], { index: i });
        ids.push(id);
      }
      
      // Then: Should apply custom pruning logic
      expect(store.getMetrics().storage.vectorCount).toBe(4);
      
      // Verify custom pruning behavior (removed even-indexed vectors)
      const remainingVectors = await Promise.all(
        ids.map(id => store.get(id))
      );
      const nonNullVectors = remainingVectors.filter(v => v !== null);
      expect(nonNullVectors).toHaveLength(4);
    });

    it('should allow configuration of pruning behavior', async () => {
      // Given: Vector store with detailed pruning configuration
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        maxVectors: 5,
        enableAutoPruning: true,
        pruningStrategy: 'lru',
        pruningConfig: {
          batchSize: 2,
          threshold: 0.8, // Start pruning at 80% capacity
          preserveCount: 2, // Always keep at least 2 vectors
          respectPinned: true, // Don't prune pinned vectors
          dryRun: false
        }
      });
      await store.initialize();
      
      // When: Adding vectors with some pinned
      await store.store([1, 1, 1], { type: 'normal' });
      await store.store([2, 2, 2], { type: 'pinned', pinned: true });
      await store.store([3, 3, 3], { type: 'normal' });
      await store.store([4, 4, 4], { type: 'pinned', pinned: true });
      
      // Trigger pruning by reaching threshold (4 vectors = 80% of 5)
      await store.store([5, 5, 5], { type: 'trigger' });
      
      // Then: Should respect pruning configuration
      const remainingVectors = await store.search([0, 0, 0], { k: 10 });
      expect(remainingVectors.length).toBeGreaterThanOrEqual(2); // preserveCount
      
      // Pinned vectors should be preserved
      const pinnedVectors = remainingVectors.filter(v => v.metadata.pinned);
      expect(pinnedVectors).toHaveLength(2);
    });

    it('should provide pruning statistics and history', async () => {
      // Given: Vector store with pruning analytics
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        maxVectors: 3,
        enableAutoPruning: true,
        pruningStrategy: 'fifo',
        trackPruningStats: true
      });
      await store.initialize();
      
      // When: Triggering multiple pruning events
      for (let i = 0; i < 6; i++) {
        await store.store([i, i, i], { batch: 1, index: i });
      }
      
      // Then: Should track pruning statistics
      const pruningStats = store.getPruningStats();
      expect(pruningStats.totalPruned).toBe(3); // 6 added - 3 capacity = 3 pruned
      expect(pruningStats.pruningEvents).toBeGreaterThan(0);
      expect(pruningStats.averagePruningTime).toBeGreaterThan(0);
      expect(pruningStats.strategy).toBe('fifo');
      
      // Should provide pruning history
      const pruningHistory = store.getPruningHistory();
      expect(pruningHistory).toHaveLength(pruningStats.pruningEvents);
      expect(pruningHistory[0]).toHaveProperty('timestamp');
      expect(pruningHistory[0]).toHaveProperty('vectorsPruned');
      expect(pruningHistory[0]).toHaveProperty('strategy');
      expect(pruningHistory[0]).toHaveProperty('reason');
    });
  });

  describe('Memory Usage Constraints', () => {
    it('should track memory usage accurately', async () => {
      // Given: Vector store with memory tracking
      store = new VectorStore({ 
        dimension: 100,
        path: testPath,
        trackMemoryUsage: true
      });
      await store.initialize();
      
      // When: Adding vectors of known size
      const vector = new Array(100).fill(0.5);
      await store.store(vector, { type: 'memory-test' });
      
      // Then: Should track memory usage
      const memoryUsage = store.getMemoryUsage();
      expect(memoryUsage.vectorMemoryMB).toBeGreaterThan(0);
      expect(memoryUsage.metadataMemoryMB).toBeGreaterThan(0);
      expect(memoryUsage.indexMemoryMB).toBeGreaterThan(0);
      expect(memoryUsage.totalMemoryMB).toBe(
        memoryUsage.vectorMemoryMB + 
        memoryUsage.metadataMemoryMB + 
        memoryUsage.indexMemoryMB
      );
    });

    it('should enforce memory-based pruning', async () => {
      // Given: Vector store with memory-based pruning
      store = new VectorStore({ 
        dimension: 1000,
        path: testPath,
        maxMemoryMB: 2,
        enableAutoPruning: true,
        pruningStrategy: 'memory-based',
        memoryPruningThreshold: 0.8 // Prune at 80% memory usage
      });
      await store.initialize();
      
      // When: Adding large vectors to approach memory limit
      const largeVector = new Array(1000).fill(Math.random());
      const ids: string[] = [];
      
      for (let i = 0; i < 5; i++) {
        const id = await store.store(largeVector, { 
          index: i, 
          size: 'large',
          timestamp: Date.now() + i 
        });
        ids.push(id);
      }
      
      // Then: Should have triggered memory-based pruning
      const memoryUsage = store.getMemoryUsage();
      expect(memoryUsage.totalMemoryMB).toBeLessThanOrEqual(2);
      
      // Some vectors should have been pruned
      const existingVectors = await Promise.all(
        ids.map(async id => await store.get(id))
      );
      const nonNullVectors = existingVectors.filter(v => v !== null);
      expect(nonNullVectors.length).toBeLessThan(5);
    });

    it('should support memory pressure monitoring', async () => {
      // Given: Vector store with memory pressure monitoring
      store = new VectorStore({ 
        dimension: 500,
        path: testPath,
        maxMemoryMB: 1,
        memoryPressureMonitoring: true,
        memoryPressureCallbacks: {
          warning: 0.7, // Callback at 70%
          critical: 0.9 // Callback at 90%
        }
      });
      await store.initialize();
      
      let warningCalled = false;
      let criticalCalled = false;
      
      store.onMemoryPressure('warning', () => { warningCalled = true; });
      store.onMemoryPressure('critical', () => { criticalCalled = true; });
      
      // When: Adding vectors to trigger memory pressure
      const mediumVector = new Array(500).fill(0.5);
      for (let i = 0; i < 3; i++) {
        await store.store(mediumVector, { index: i });
      }
      
      // Then: Should trigger memory pressure callbacks
      expect(warningCalled).toBe(true);
      expect(criticalCalled).toBe(true);
    });
  });

  describe('Workspace-Specific Limits', () => {
    it('should enforce per-workspace vector limits', async () => {
      // Given: Vector store with workspace-specific configuration
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        workspaceIsolation: true,
        workspaceConfig: {
          'project-a': { maxVectors: 2, pruningStrategy: 'fifo' },
          'project-b': { maxVectors: 5, pruningStrategy: 'lru' },
          'default': { maxVectors: 3, pruningStrategy: 'priority' }
        }
      });
      await store.initialize();
      
      // When: Adding vectors to different workspaces
      await store.store([1, 1, 1], { workspaceId: 'project-a', type: 'test' });
      await store.store([2, 2, 2], { workspaceId: 'project-a', type: 'test' });
      
      // project-a should be at limit (2 vectors)
      const exceedProjectA = store.store([3, 3, 3], { workspaceId: 'project-a', type: 'test' });
      await expect(exceedProjectA).rejects.toThrow('Maximum vectors (2) exceeded for workspace project-a');
      
      // project-b should allow more vectors
      for (let i = 0; i < 5; i++) {
        await store.store([i, i, i], { workspaceId: 'project-b', type: 'test' });
      }
      
      // Then: Should enforce workspace-specific limits
      expect(await store.getWorkspaceVectorCount('project-a')).toBe(2);
      expect(await store.getWorkspaceVectorCount('project-b')).toBe(5);
    });

    it('should apply workspace-specific pruning strategies', async () => {
      // Given: Vector store with different pruning per workspace
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        workspaceIsolation: true,
        enableAutoPruning: true,
        workspaceConfig: {
          'fifo-workspace': { 
            maxVectors: 2, 
            pruningStrategy: 'fifo',
            trackPruningStats: true
          },
          'lru-workspace': { 
            maxVectors: 2, 
            pruningStrategy: 'lru',
            trackPruningStats: true
          }
        }
      });
      await store.initialize();
      
      // When: Adding vectors to trigger different pruning strategies
      // FIFO workspace
      const fifoId1 = await store.store([1, 1, 1], { workspaceId: 'fifo-workspace', timestamp: 1000 });
      await new Promise(resolve => setTimeout(resolve, 10));
      const fifoId2 = await store.store([2, 2, 2], { workspaceId: 'fifo-workspace', timestamp: 2000 });
      await new Promise(resolve => setTimeout(resolve, 10));
      const fifoId3 = await store.store([3, 3, 3], { workspaceId: 'fifo-workspace', timestamp: 3000 });
      
      // LRU workspace
      const lruId1 = await store.store([1, 1, 1], { workspaceId: 'lru-workspace', type: 'test' });
      const lruId2 = await store.store([2, 2, 2], { workspaceId: 'lru-workspace', type: 'test' });
      
      // Access lruId1 to make it recently used
      await store.get(lruId1);
      
      const lruId3 = await store.store([3, 3, 3], { workspaceId: 'lru-workspace', type: 'test' });
      
      // Then: Should apply workspace-specific pruning strategies
      // FIFO: oldest (fifoId1) should be removed
      expect(await store.get(fifoId1)).toBeNull();
      expect(await store.get(fifoId2)).not.toBeNull();
      expect(await store.get(fifoId3)).not.toBeNull();
      
      // LRU: least recently used (lruId2) should be removed
      expect(await store.get(lruId1)).not.toBeNull(); // Recently accessed
      expect(await store.get(lruId2)).toBeNull(); // LRU
      expect(await store.get(lruId3)).not.toBeNull(); // Newly added
    });

    it('should provide workspace-specific constraint analytics', async () => {
      // Given: Vector store with workspace analytics
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        workspaceIsolation: true,
        enableWorkspaceAnalytics: true,
        workspaceConfig: {
          'analytics-workspace': { maxVectors: 3, trackDetailedStats: true }
        }
      });
      await store.initialize();
      
      // When: Operating on workspace
      await store.store([1, 1, 1], { workspaceId: 'analytics-workspace', type: 'test' });
      await store.store([2, 2, 2], { workspaceId: 'analytics-workspace', type: 'test' });
      
      // Then: Should provide workspace analytics
      const workspaceStats = await store.getWorkspaceStats('analytics-workspace');
      expect(workspaceStats.vectorCount).toBe(2);
      expect(workspaceStats.memoryUsageMB).toBeGreaterThan(0);
      expect(workspaceStats.constraintUtilization.vectors).toBe(2/3); // 2 out of 3 max
      expect(workspaceStats.pruningHistory).toBeDefined();
      expect(workspaceStats.lastActivity).toBeDefined();
    });
  });

  describe('Configuration and Validation', () => {
    it('should validate constraint configuration on initialization', async () => {
      // Given: Invalid constraint configuration
      const invalidConfig = {
        dimension: 3,
        maxVectors: -1, // Invalid negative value
        maxMemoryMB: 0,  // Invalid zero value
        enableAutoPruning: true,
        pruningStrategy: 'invalid-strategy' // Invalid strategy
      };
      
      // When: Initializing with invalid config
      store = new VectorStore(invalidConfig);
      const initPromise = store.initialize();
      
      // Then: Should reject with validation errors
      await expect(initPromise).rejects.toThrow(/Invalid constraint configuration/);
    });

    it('should provide constraint configuration recommendations', async () => {
      // Given: Vector store with recommendation engine
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        enableConfigRecommendations: true
      });
      await store.initialize();
      
      // When: Adding vectors and requesting recommendations
      for (let i = 0; i < 100; i++) {
        await store.store([i, i, i], { type: 'bulk', timestamp: Date.now() + i });
      }
      
      // Then: Should provide configuration recommendations
      const recommendations = store.getConfigRecommendations();
      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0]).toHaveProperty('type');
      expect(recommendations[0]).toHaveProperty('current');
      expect(recommendations[0]).toHaveProperty('recommended');
      expect(recommendations[0]).toHaveProperty('reason');
      expect(recommendations[0]).toHaveProperty('impact');
    });

    it('should support dynamic constraint updates', async () => {
      // Given: Vector store with initial constraints
      store = new VectorStore({ 
        dimension: 3,
        path: testPath,
        maxVectors: 5,
        enableAutoPruning: false
      });
      await store.initialize();
      
      // When: Adding vectors up to initial limit
      for (let i = 0; i < 5; i++) {
        await store.store([i, i, i], { index: i });
      }
      
      // When: Updating constraints dynamically
      await store.updateConstraints({
        maxVectors: 3,
        enableAutoPruning: true,
        pruningStrategy: 'fifo'
      });
      
      // Then: Should apply new constraints immediately
      expect(store.getMetrics().storage.vectorCount).toBe(3); // Should have pruned to new limit
      
      // Verify constraint updates
      const currentConstraints = store.getConstraintConfig();
      expect(currentConstraints.maxVectors).toBe(3);
      expect(currentConstraints.enableAutoPruning).toBe(true);
      expect(currentConstraints.pruningStrategy).toBe('fifo');
    });

    it('should validate constraint compatibility', async () => {
      // Given: Vector store setup
      store = new VectorStore({ 
        dimension: 3,
        path: testPath
      });
      await store.initialize();
      
      // When: Checking constraint compatibility
      const compatibility = store.validateConstraintCompatibility({
        maxVectors: 100,
        maxMemoryMB: 0.1, // Very small memory with large vector count
        enableAutoPruning: false // No pruning with tight limits
      });
      
      // Then: Should identify compatibility issues
      expect(compatibility.isCompatible).toBe(false);
      expect(compatibility.warnings).toContain('Memory limit too small for vector count');
      expect(compatibility.warnings).toContain('Auto-pruning recommended with tight constraints');
      expect(compatibility.recommendations).toContain('Enable auto-pruning');
      expect(compatibility.recommendations).toContain('Increase memory limit or reduce vector count');
    });
  });
});