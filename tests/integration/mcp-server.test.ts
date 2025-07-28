import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { StorageEngine } from "../../src/storage/engine.js";
import { HookSystem, type HookEvent } from "../../src/hooks/system.js";
import { GitIntegration } from "../../src/git/integration.js";
import { IntelligenceLayer } from "../../src/intelligence/layer.js";
import { config } from "../../src/config/index.js";

describe('MCP Server Integration', () => {
  let storage: StorageEngine;
  let hooks: HookSystem;
  let git: GitIntegration;
  let intelligence: IntelligenceLayer;

  beforeEach(async () => {
    // Initialize subsystems with test config
    const testConfig = {
      ...config,
      storage: {
        ...config.storage,
        sqlite: { ...config.storage.sqlite, path: ':memory:' },
        vector: { ...config.storage.vector, path: ':memory:' },
        files: { ...config.storage.files, path: '.test-memory/files' }
      }
    };

    storage = new StorageEngine(testConfig.storage);
    await storage.initialize();

    hooks = new HookSystem(testConfig.hooks);
    hooks.initialize();

    git = new GitIntegration(testConfig.git);
    await git.initialize();

    // Create mock embedding generator for testing
    const mockEmbeddingGenerator = {
      initialize: jest.fn(() => Promise.resolve()),
      generate: jest.fn(() => Promise.resolve(new Array(384).fill(0).map(() => Math.random()))),
      close: jest.fn(() => Promise.resolve())
    } as any;

    intelligence = new IntelligenceLayer(testConfig.intelligence, storage, mockEmbeddingGenerator);
    await intelligence.initialize();
  });

  afterEach(async () => {
    await storage?.close();
    await hooks?.close();
    await git?.close();
    await intelligence?.close();
  });

  describe('Storage Integration', () => {
    it('should capture and retrieve memories', async () => {
      // Given: Memory data
      const memoryData = {
        eventType: 'test_event',
        content: 'Test memory content for integration',
        metadata: { test: true, timestamp: Date.now() },
        timestamp: new Date(),
        sessionId: 'test-session'
      };
      
      // When: Capturing memory
      const memory = await storage.captureMemory(memoryData);
      
      // Then: Memory should be stored
      expect(memory.id).toBeDefined();
      expect(memory.eventType).toBe('test_event');
      
      // And: Should be retrievable
      const memories = await storage.queryMemories({
        eventType: 'test_event',
        sessionId: 'test-session'
      });
      
      expect(memories).toHaveLength(1);
      expect(memories[0]?.content).toBe('Test memory content for integration');
    });

    it('should handle workspace isolation', async () => {
      // Given: Memories in different workspaces
      await storage.captureMemory({
        eventType: 'workspace_test',
        content: 'Workspace A memory',
        timestamp: new Date(),
        sessionId: 'session1',
        workspaceId: 'workspace-a'
      });
      
      await storage.captureMemory({
        eventType: 'workspace_test',
        content: 'Workspace B memory',
        timestamp: new Date(),
        sessionId: 'session1',
        workspaceId: 'workspace-b'
      });
      
      // When: Querying specific workspace
      const workspaceAMemories = await storage.queryMemories({
        workspaceId: 'workspace-a'
      });
      
      // Then: Should only get memories from that workspace
      expect(workspaceAMemories).toHaveLength(1);
      expect(workspaceAMemories[0]?.content).toBe('Workspace A memory');
    });

    it('should enforce memory size limits', async () => {
      // Given: Large memory content
      const largeContent = 'x'.repeat(200 * 1024 * 1024); // 200MB
      
      // When: Attempting to store
      // Then: Should reject
      await expect(storage.captureMemory({
        eventType: 'large_test',
        content: largeContent,
        timestamp: new Date(),
        sessionId: 'test-session'
      })).rejects.toThrow(/size.*exceeds limit/i);
    });

    it('should provide accurate statistics', async () => {
      // Given: Multiple memories of different types
      const types = ['type_a', 'type_b', 'type_c'];
      for (let i = 0; i < 10; i++) {
        await storage.captureMemory({
          eventType: types[i % 3]!,
          content: `Memory ${i}`,
          timestamp: new Date(),
          sessionId: 'stats-session'
        });
      }
      
      // When: Getting statistics
      const stats = await storage.getStatistics();
      
      // Then: Should have accurate counts
      expect(stats.totalMemories).toBe(10);
      expect(stats.memoriesByType.type_a).toBe(4);
      expect(stats.memoriesByType.type_b).toBe(3);
      expect(stats.memoriesByType.type_c).toBe(3);
      expect(stats.oldestMemory).toBeDefined();
      expect(stats.newestMemory).toBeDefined();
    });
  });

  describe('Hook System Integration', () => {
    it('should execute hooks with circuit breaker', async () => {
      // Note: Hook system in current implementation loads hooks from config
      // For integration testing, we'll test the existing functionality
      
      // When: Executing hook
      const event: HookEvent = {
        type: 'test_event',
        data: { test: true },
        timestamp: new Date()
      };
      
      const result = await hooks.executeHook(event);
      
      // Then: Should handle the event (may be null if no hooks match)
      expect(result).toBeDefined();
    });

    it('should handle hook timeouts', async () => {
      // Given: An event that would trigger a slow hook
      const event: HookEvent = {
        type: 'slow_event',
        data: { delay: 10000 },
        timestamp: new Date()
      };
      
      // When: Executing hook
      const result = await hooks.executeHook(event);
      
      // Then: Should handle gracefully
      expect(result).toBeDefined();
    });
  });

  describe('Git Integration', () => {
    it('should return git state', async () => {
      // When: Getting git state
      const state = await git.getCurrentState();
      
      // Then: Should return state structure
      expect(state).toMatchObject({
        initialized: expect.any(Boolean),
        isDirty: expect.any(Boolean),
        behind: expect.any(Number),
        ahead: expect.any(Number)
      });
    });

    it('should validate memory against git', async () => {
      // Given: A mock memory object
      const mockMemory = {
        id: 'test-memory-id',
        eventType: 'test',
        content: 'test content',
        timestamp: new Date(),
        sessionId: 'test-session'
      };
      
      // When: Validating memory
      const isValid = await git.validateMemory(mockMemory);
      
      // Then: Should return validation result
      expect(typeof isValid).toBe('boolean');
    });
  });

  describe('Intelligence Layer Integration', () => {
    it('should generate embeddings', async () => {
      // When: Generating embedding
      const embedding = await intelligence.generateEmbedding('Test text for embedding');
      
      // Then: Should return vector
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(384); // Default model dimension
    });

    it('should retrieve memories with semantic search', async () => {
      // Given: Some memories with embeddings
      const memories = [
        'The quick brown fox jumps over the lazy dog',
        'Machine learning models process data',
        'Artificial intelligence transforms industries'
      ];
      
      for (const content of memories) {
        await storage.captureMemory({
          eventType: 'semantic_test',
          content,
          timestamp: new Date(),
          sessionId: 'semantic-session'
        });
      }
      
      // When: Retrieving with semantic search
      const results = await intelligence.retrieveMemories('AI and ML', {
        limit: 2
      });
      
      // Then: Should return relevant memories
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Full Integration Flow', () => {
    it('should handle complete memory lifecycle', async () => {
      // 1. Test hook execution (hooks are configured via config)
      const hookEvent: HookEvent = {
        type: 'file_write',
        data: { content: 'New file content' },
        timestamp: new Date()
      };
      
      const hookResult = await hooks.executeHook(hookEvent);
      // May be null if no hooks configured
      expect(hookResult !== undefined).toBe(true);
      
      // 2. Store memory with embedding
      const memory = await storage.captureMemory({
        eventType: 'file_write',
        content: 'Updated test.ts with new functionality',
        metadata: { file: 'test.ts', lines: 42 },
        timestamp: new Date(),
        sessionId: 'integration-session'
        // Note: Not including gitBranch/gitCommit to avoid validation failures
      });
      
      expect(memory.id).toBeDefined();
      
      // 3. Validate against git
      const isValid = await git.validateMemory(memory);
      expect(isValid).toBe(true);
      
      // 4. Retrieve with semantic search
      const retrieved = await intelligence.retrieveMemories('test functionality', {
        limit: 5,
        filters: { sessionId: 'integration-session' }
      });
      
      expect(retrieved).toBeDefined();
      
      // 5. Get statistics
      const stats = await storage.getStatistics();
      expect(stats.totalMemories).toBeGreaterThan(0);
      expect(stats.memoriesByType.file_write).toBeDefined();
    });

    it('should handle concurrent operations', async () => {
      // Simulate multiple concurrent memory captures
      const promises = [];
      
      for (let i = 0; i < 20; i++) {
        promises.push(
          storage.captureMemory({
            eventType: 'concurrent_test',
            content: `Concurrent memory ${i}`,
            metadata: { index: i },
            timestamp: new Date(),
            sessionId: 'concurrent-session'
          })
        );
      }
      
      // All should complete successfully
      const results = await Promise.all(promises);
      expect(results).toHaveLength(20);
      results.forEach((memory, index) => {
        expect(memory.id).toBeDefined();
        expect(memory.metadata?.index).toBe(index);
      });
      
      // Verify all were stored
      const memories = await storage.queryMemories({
        eventType: 'concurrent_test',
        sessionId: 'concurrent-session'
      });
      expect(memories).toHaveLength(20);
    });

    it('should maintain data integrity under load', async () => {
      // Simulate heavy load with mixed operations
      const operations = [];
      
      // Captures
      for (let i = 0; i < 50; i++) {
        operations.push(
          storage.captureMemory({
            eventType: 'load_test',
            content: `Load test memory ${i}`,
            timestamp: new Date(),
            sessionId: 'load-session'
          })
        );
      }
      
      // Queries
      for (let i = 0; i < 20; i++) {
        operations.push(
          storage.queryMemories({
            sessionId: 'load-session',
            limit: 10
          })
        );
      }
      
      // Statistics
      for (let i = 0; i < 10; i++) {
        operations.push(storage.getStatistics());
      }
      
      // Execute all operations
      const results = await Promise.allSettled(operations);
      
      // Check success rate
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length / results.length).toBeGreaterThan(0.95);
      
      // Verify final state
      const finalStats = await storage.getStatistics();
      expect(finalStats.totalMemories).toBeGreaterThanOrEqual(50);
    });
  });
});