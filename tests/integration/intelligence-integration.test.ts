import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { StorageEngine } from "../../src/storage/engine.js";
import { IntelligenceLayer } from "../../src/intelligence/layer.js";
import { HookSystem } from "../../src/hooks/system.js";
import { config } from "../../src/config/index.js";
import type { Config } from "../../src/config/index.js";
import { rmSync } from "fs";

describe('Intelligence Layer Integration', () => {
  let testConfig: Config;
  let storage: StorageEngine;
  let intelligence: IntelligenceLayer;
  let hooks: HookSystem;
  let testDir: string;

  beforeEach(async () => {
    // Create test configuration
    testDir = `.test-memory-${Date.now()}`;
    testConfig = {
      ...config,
      storage: {
        ...config.storage,
        sqlite: { ...config.storage.sqlite, path: testDir + '/memory.db' },
        vector: { ...config.storage.vector, path: testDir + '/vector.db' },
        files: { ...config.storage.files, path: testDir + '/files' }
      }
    };
    
    // Initialize all subsystems
    storage = new StorageEngine(testConfig.storage);
    await storage.initialize();
    
    intelligence = new IntelligenceLayer(testConfig.intelligence, storage);
    await intelligence.initialize();
    
    hooks = new HookSystem(testConfig.hooks);
    await hooks.initialize();
  });

  afterEach(async () => {
    // Cleanup
    await intelligence.close();
    await storage.close();
    await hooks.close();
    
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Full Memory Lifecycle', () => {
    it('should complete full memory lifecycle with semantic search', async () => {
      // 1. Capture memory with embedding
      const memory = await storage.captureMemory({
        eventType: 'code_write',
        content: `
          export class UserAuthenticationService {
            async login(email: string, password: string): Promise<User> {
              const user = await this.userRepository.findByEmail(email);
              if (!user || !await bcrypt.compare(password, user.passwordHash)) {
                throw new UnauthorizedError('Invalid credentials');
              }
              const token = jwt.sign({ userId: user.id }, JWT_SECRET);
              return { ...user, token };
            }
          }
        `,
        metadata: {
          file: 'src/services/auth.service.ts',
          language: 'typescript'
        },
        sessionId: 'test-session',
        timestamp: new Date()
      });

      expect(memory.id).toBeDefined();

      // 2. Retrieve using semantic search
      const results = await intelligence.retrieveMemories(
        'user authentication implementation',
        { limit: 5 }
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.content).toContain('UserAuthenticationService');
      expect(results[0]!.score).toBeGreaterThan(0.3);

      // 3. Build context for injection
      const context = await intelligence.buildContext(results);
      
      expect(context).toContain('# Retrieved Context');
      expect(context).toContain('## Memory 1');
      expect(context).toContain('UserAuthenticationService');
      expect(context.length).toBeLessThan(15000); // Within context size limit
    });

    it('should handle multiple related memories', async () => {
      // Create multiple related memories
      await storage.captureMemory({
        eventType: 'code_write',
        content: 'import bcrypt from "bcryptjs";\nimport jwt from "jsonwebtoken";',
        metadata: { file: 'src/services/auth.service.ts', lines: 2 },
        sessionId: 'test-session',
        timestamp: new Date()
      });

      await storage.captureMemory({
        eventType: 'code_write',
        content: 'export interface User { id: string; email: string; passwordHash: string; }',
        metadata: { file: 'src/models/user.model.ts' },
        sessionId: 'test-session',
        timestamp: new Date()
      });

      await storage.captureMemory({
        eventType: 'command_run',
        content: 'npm test auth.service.test.ts',
        metadata: { exitCode: 0, duration: 1234 },
        sessionId: 'test-session',
        timestamp: new Date()
      });

      // Search for authentication-related memories
      const results = await intelligence.retrieveMemories('authentication user', {
        limit: 10
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);
      
      // Verify results are ordered by relevance
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
      }
    });
  });

  describe('Workspace and Git Branch Isolation', () => {
    it('should handle workspace and git branch isolation', async () => {
      // Create memories in different contexts
      await storage.captureMemory({
        eventType: 'test',
        content: 'Main branch memory',
        sessionId: 'session1',
        workspaceId: 'project-a',
        gitBranch: 'main',
        timestamp: new Date()
      });

      await storage.captureMemory({
        eventType: 'test',
        content: 'Feature branch memory',
        sessionId: 'session1',
        workspaceId: 'project-a',
        gitBranch: 'feature/new-feature',
        timestamp: new Date()
      });

      await storage.captureMemory({
        eventType: 'test',
        content: 'Different project memory',
        sessionId: 'session1',
        workspaceId: 'project-b',
        gitBranch: 'main',
        timestamp: new Date()
      });

      // Search with filters
      const mainBranchResults = await intelligence.retrieveMemories('memory', {
        filters: {
          workspaceId: 'project-a',
          gitBranch: 'main'
        }
      });

      expect(mainBranchResults).toHaveLength(1);
      expect(mainBranchResults[0]!.content).toBe('Main branch memory');

      // Search in feature branch
      const featureBranchResults = await intelligence.retrieveMemories('memory', {
        filters: {
          workspaceId: 'project-a',
          gitBranch: 'feature/new-feature'
        }
      });

      expect(featureBranchResults).toHaveLength(1);
      expect(featureBranchResults[0]!.content).toBe('Feature branch memory');
    });
  });

  describe('Performance Under Load', () => {
    it('should maintain performance under load', async () => {
      // Helper to generate random code
      const generateRandomCode = (index: number) => {
        const functions = ['authenticate', 'authorize', 'validate', 'process', 'handle'];
        const types = ['User', 'Request', 'Response', 'Token', 'Session'];
        return `
          function ${functions[index % functions.length]}${types[index % types.length]}(data: any) {
            // Implementation ${index}
            return processData(data);
          }
        `;
      };

      // Create 100 memories
      const memories = [];
      for (let i = 0; i < 100; i++) {
        memories.push(
          storage.captureMemory({
            eventType: 'code_write',
            content: `Function ${i}: ${generateRandomCode(i)}`,
            sessionId: 'load-test',
            timestamp: new Date()
          })
        );
      }

      await Promise.all(memories);

      // Measure retrieval performance
      const start = Date.now();
      const results = await intelligence.retrieveMemories(
        'function implementation',
        { limit: 10 }
      );
      const duration = Date.now() - start;

      expect(results).toHaveLength(10);
      expect(duration).toBeLessThan(500); // Allow more time for integration test
    });
  });

  describe('Query Caching', () => {
    it('should cache query results for performance', async () => {
      // Create test memory
      await storage.captureMemory({
        eventType: 'code_write',
        content: 'Cached content for testing',
        sessionId: 'cache-test',
        timestamp: new Date()
      });

      // First query (cache miss)
      const start1 = Date.now();
      const results1 = await intelligence.retrieveMemories('cached content', { limit: 5 });
      const time1 = Date.now() - start1;

      // Second query (cache hit)
      const start2 = Date.now();
      const results2 = await intelligence.retrieveMemories('cached content', { limit: 5 });
      const time2 = Date.now() - start2;

      // Verify results are the same
      expect(results2).toEqual(results1);
      
      // Cache hit should be much faster
      expect(time2).toBeLessThan(time1 / 2);
      
      // Verify cache is being used
      const cache = intelligence.getQueryCache();
      expect(cache.size).toBeGreaterThan(0);
    });
  });

  describe('SQL Fallback', () => {
    it('should fall back to SQL search when vector store unavailable', async () => {
      // Create a new storage without vector store by mocking getVectorStore
      const intelligenceWithFallback = new IntelligenceLayer(
        testConfig.intelligence,
        storage
      );
      await intelligenceWithFallback.initialize();
      
      // Mock getVectorStore to return null
      jest.spyOn(storage, 'getVectorStore').mockResolvedValue(null);

      // Create test memories
      await storage.captureMemory({
        eventType: 'code_write',
        content: 'SQL fallback test content with specific keywords',
        sessionId: 'fallback-test',
        timestamp: new Date()
      });

      // Search should still work via SQL fallback
      const results = await intelligenceWithFallback.retrieveMemories(
        'specific keywords',
        { limit: 5 }
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.content).toContain('specific keywords');
      expect(results[0]!.score).toBeGreaterThan(0);

      await intelligenceWithFallback.close();
    });
  });

  describe('Context Building', () => {
    it('should build formatted context with metadata', async () => {
      // Create diverse memory types
      await storage.captureMemory({
        eventType: 'code_write',
        content: 'export function authenticate() { /* auth logic */ }',
        metadata: { 
          file: 'auth.ts',
          language: 'typescript',
          functions: ['authenticate']
        },
        sessionId: 'context-test',
        timestamp: new Date()
      });

      await storage.captureMemory({
        eventType: 'command_run',
        content: 'npm test',
        metadata: {
          command: 'npm test',
          exitCode: 0,
          duration: 5000,
          cwd: '/project'
        },
        sessionId: 'context-test',
        timestamp: new Date()
      });

      const results = await intelligence.retrieveMemories('test', { limit: 10 });
      const context = await intelligence.buildContext(results);

      // Verify context formatting
      expect(context).toContain('# Retrieved Context');
      expect(context).toContain('Memory');
      
      // Context should include metadata
      expect(context).toMatch(/Type:.*code_write/);
      expect(context).toMatch(/Type:.*command_run/);
      expect(context).toMatch(/Exit Code:.*0/);
    });
  });

  describe('Error Handling', () => {
    it('should handle retrieval errors gracefully', async () => {
      // Close storage to simulate error
      await storage.close();

      // Should fall back gracefully
      const results = await intelligence.retrieveMemories('test query', { limit: 5 });
      
      // Should return empty array rather than throwing
      expect(results).toEqual([]);
    });

    it('should handle initialization errors', async () => {
      const badIntelligence = new IntelligenceLayer(testConfig.intelligence);
      
      // Should throw when not initialized
      await expect(badIntelligence.retrieveMemories('test')).rejects.toThrow(
        'Intelligence layer not initialized'
      );
    });
  });
});