import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { StorageEngine } from "../../src/storage/engine.js";
import { Config } from "../../src/config/index.js";
import fs from "fs";
import path from "path";

describe('StorageEngine', () => {
  let engine: StorageEngine;
  const testDbPath = path.join(process.cwd(), '.test-memory', 'engine-test.db');
  
  const testConfig: Config["storage"] = {
    sqlite: {
      path: testDbPath,
      walMode: true,
      busyTimeout: 5000,
      cacheSize: 10000
    },
    vector: {
      provider: 'local',
      path: './.test-memory/vectors',
      dimension: 384
    },
    files: {
      path: './.test-memory/files',
      maxSize: '10MB'
    },
    limits: {
      maxMemorySize: '1MB',
      maxMemoriesPerProject: 1000,
      maxFileSize: '10MB'
    }
  };

  beforeEach(async () => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    engine = new StorageEngine(testConfig);
  });

  afterEach(async () => {
    // Clean up after tests
    if (engine) {
      await engine.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('initialization', () => {
    it('should initialize all storage subsystems', async () => {
      // When: Engine is initialized
      await engine.initialize();
      
      // Then: Database file exists
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should throw when used before initialization', async () => {
      // Given: Uninitialized engine
      const memory = {
        eventType: 'test',
        content: 'test content',
        timestamp: new Date(),
        sessionId: 'test-session'
      };
      
      // Then: Operations throw
      await expect(engine.captureMemory(memory)).rejects.toThrow('Storage engine not initialized');
      await expect(engine.getStatistics()).rejects.toThrow('Storage engine not initialized');
    });
  });

  describe('memory capture', () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it('should store memory with generated ID', async () => {
      // Given: A memory object
      const memory = {
        eventType: 'file_write',
        content: 'Updated user service',
        metadata: { file: 'src/services/user.ts', lines: 150 },
        timestamp: new Date(),
        sessionId: 'session-123',
        workspaceId: 'workspace-456',
        gitBranch: 'feature/user-auth',
        gitCommit: 'def456'
      };
      
      // When: Memory is captured
      const captured = await engine.captureMemory(memory);
      
      // Then: Memory has ID and matches input
      expect(captured.id).toMatch(/^mem_\d+_[a-z0-9]+$/);
      expect(captured.eventType).toBe(memory.eventType);
      expect(captured.content).toBe(memory.content);
      expect(captured.metadata).toEqual(memory.metadata);
      expect(captured.sessionId).toBe(memory.sessionId);
    });

    it('should validate required fields', async () => {
      // Given: Invalid memory objects
      const invalidMemories = [
        {
          // Missing eventType
          content: 'test',
          timestamp: new Date(),
          sessionId: 'test'
        },
        {
          eventType: 'test',
          // Missing content
          timestamp: new Date(),
          sessionId: 'test'
        },
        {
          eventType: 'test',
          content: 'test',
          timestamp: new Date(),
          // Missing sessionId
        }
      ];
      
      // Then: Each throws validation error
      for (const memory of invalidMemories) {
        await expect(engine.captureMemory(memory as any))
          .rejects.toThrow(/is required/);
      }
    });

    it('should enforce size limits', async () => {
      // Given: A memory exceeding size limit (1MB limit in config)
      const largeContent = 'x'.repeat(1024 * 1024 + 1); // Just over 1MB
      const memory = {
        eventType: 'large_content',
        content: largeContent,
        timestamp: new Date(),
        sessionId: 'test-session'
      };
      
      // Then: Throws size error
      await expect(engine.captureMemory(memory))
        .rejects.toThrow(/exceeds limit/);
    });

    it('should handle metadata correctly', async () => {
      // Given: Memory with complex metadata
      const memory = {
        eventType: 'api_request',
        content: 'POST /api/users',
        metadata: {
          method: 'POST',
          path: '/api/users',
          statusCode: 201,
          responseTime: 145,
          headers: {
            'content-type': 'application/json'
          }
        },
        timestamp: new Date(),
        sessionId: 'api-session'
      };
      
      // When: Memory is captured
      const captured = await engine.captureMemory(memory);
      
      // Then: Metadata is preserved
      expect(captured.metadata).toEqual(memory.metadata);
    });
  });

  describe('statistics', () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it('should return empty statistics initially', async () => {
      // When: Getting statistics
      const stats = await engine.getStatistics();
      
      // Then: Stats show empty state
      expect(stats.totalMemories).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.memoriesByType).toEqual({});
      expect(stats.oldestMemory).toBeUndefined();
      expect(stats.newestMemory).toBeUndefined();
    });

    it('should track memories by type', async () => {
      // Given: Multiple memories of different types
      const memories = [
        {
          eventType: 'file_write',
          content: 'Write 1',
          timestamp: new Date(),
          sessionId: 'test'
        },
        {
          eventType: 'file_write',
          content: 'Write 2',
          timestamp: new Date(),
          sessionId: 'test'
        },
        {
          eventType: 'command_run',
          content: 'npm test',
          timestamp: new Date(),
          sessionId: 'test'
        }
      ];
      
      // When: Memories are captured
      for (const memory of memories) {
        await engine.captureMemory(memory);
      }
      
      // Then: Statistics reflect the data
      const stats = await engine.getStatistics();
      expect(stats.totalMemories).toBe(3);
      expect(stats.memoriesByType).toEqual({
        'file_write': 2,
        'command_run': 1
      });
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.oldestMemory).toBeInstanceOf(Date);
      expect(stats.newestMemory).toBeInstanceOf(Date);
    });

    it('should calculate total size correctly', async () => {
      // Given: Memories with known content sizes
      const memories = [
        {
          eventType: 'test',
          content: 'a'.repeat(100), // 100 bytes
          timestamp: new Date(),
          sessionId: 'test'
        },
        {
          eventType: 'test',
          content: 'b'.repeat(200), // 200 bytes
          metadata: { key: 'value' }, // Additional metadata size
          timestamp: new Date(),
          sessionId: 'test'
        }
      ];
      
      // When: Memories are captured
      for (const memory of memories) {
        await engine.captureMemory(memory);
      }
      
      // Then: Total size is at least the content size
      const stats = await engine.getStatistics();
      expect(stats.totalSize).toBeGreaterThanOrEqual(300);
    });
  });

  describe('memory querying', () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it('should query memories by workspace', async () => {
      // Given: Memories in different workspaces
      await engine.captureMemory({
        eventType: 'test',
        content: 'workspace1 content',
        workspaceId: 'ws1',
        sessionId: 's1',
        timestamp: new Date()
      });
      
      await engine.captureMemory({
        eventType: 'test',
        content: 'workspace2 content',
        workspaceId: 'ws2',
        sessionId: 's2',
        timestamp: new Date()
      });
      
      // When: Querying workspace 1
      const memories = await engine.queryMemories({ workspaceId: 'ws1' });
      
      // Then: Only workspace 1 memories returned
      expect(memories).toHaveLength(1);
      expect(memories[0]!.content).toBe('workspace1 content');
    });

    it('should query memories by event type', async () => {
      // Given: Memories with different event types
      await engine.captureMemory({
        eventType: 'file_write',
        content: 'File write content',
        sessionId: 'test',
        timestamp: new Date()
      });
      
      await engine.captureMemory({
        eventType: 'command_run',
        content: 'Command run content',
        sessionId: 'test',
        timestamp: new Date()
      });
      
      // When: Querying by event type
      const memories = await engine.queryMemories({ eventType: 'file_write' });
      
      // Then: Only file_write memories returned
      expect(memories).toHaveLength(1);
      expect(memories[0]!.eventType).toBe('file_write');
    });

    it('should query memories by session', async () => {
      // Given: Memories in different sessions
      await engine.captureMemory({
        eventType: 'test',
        content: 'Session 1 content',
        sessionId: 'session1',
        timestamp: new Date()
      });
      
      await engine.captureMemory({
        eventType: 'test',
        content: 'Session 2 content',
        sessionId: 'session2',
        timestamp: new Date()
      });
      
      // When: Querying by session
      const memories = await engine.queryMemories({ sessionId: 'session1' });
      
      // Then: Only session 1 memories returned
      expect(memories).toHaveLength(1);
      expect(memories[0]!.sessionId).toBe('session1');
    });

    it('should support limit and ordering', async () => {
      // Given: Multiple memories with different timestamps
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        await engine.captureMemory({
          eventType: 'test',
          content: `Memory ${i}`,
          sessionId: 'test',
          timestamp: new Date(now + i * 1000) // Each 1 second apart
        });
      }
      
      // When: Querying with limit
      const memories = await engine.queryMemories({ 
        sessionId: 'test',
        limit: 3,
        orderBy: 'timestamp',
        orderDirection: 'DESC'
      });
      
      // Then: Returns limited results in correct order
      expect(memories).toHaveLength(3);
      expect(memories[0]!.content).toBe('Memory 4'); // Latest first
      expect(memories[1]!.content).toBe('Memory 3');
      expect(memories[2]!.content).toBe('Memory 2');
    });

    it('should support date range queries', async () => {
      // Given: Memories across different dates
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const today = new Date();
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      await engine.captureMemory({
        eventType: 'test',
        content: 'Yesterday',
        sessionId: 'test',
        timestamp: yesterday
      });
      
      await engine.captureMemory({
        eventType: 'test',
        content: 'Today',
        sessionId: 'test',
        timestamp: today
      });
      
      await engine.captureMemory({
        eventType: 'test',
        content: 'Tomorrow',
        sessionId: 'test',
        timestamp: tomorrow
      });
      
      // When: Querying date range
      const memories = await engine.queryMemories({
        startTime: yesterday,
        endTime: today
      });
      
      // Then: Only memories in range returned
      expect(memories).toHaveLength(2);
      expect(memories.map(m => m.content)).toEqual(['Yesterday', 'Today']);
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      // Given: An engine with invalid database path
      const badConfig: Config["storage"] = {
        ...testConfig,
        sqlite: {
          ...testConfig.sqlite,
          path: '/invalid/path/that/cannot/exist/test.db'
        }
      };
      
      const badEngine = new StorageEngine(badConfig);
      
      // Then: Initialize throws appropriate error
      await expect(badEngine.initialize()).rejects.toThrow();
    });
  });
});