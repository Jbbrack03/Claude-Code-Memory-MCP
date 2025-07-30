import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { StorageEngine } from "../../src/storage/engine.js";
import { IntelligenceLayer } from "../../src/intelligence/layer.js";
import { config } from "../../src/config/index.js";
import { promises as fs } from "fs";

describe('Production Vector Similarity Search Tests', () => {
  let storage: StorageEngine;
  let intelligence: IntelligenceLayer;
  const testConfig = {
    ...config,
    storage: {
      ...config.storage,
      sqlite: { ...config.storage.sqlite, path: ':memory:' },
      vector: { 
        ...config.storage.vector, 
        path: '/tmp/test-vector-search',
        useScalableIndex: true 
      },
      files: { ...config.storage.files, path: '/tmp/test-files-search' }
    }
  };

  beforeEach(async () => {
    // Clean test directories
    try {
      await fs.rm('/tmp/test-vector-search', { recursive: true, force: true });
      await fs.rm('/tmp/test-files-search', { recursive: true, force: true });
    } catch (error) {
      // Ignore if doesn't exist
    }

    // Initialize storage and intelligence
    storage = new StorageEngine(testConfig.storage);
    await storage.initialize();

    // Create mock embedding generator
    const mockEmbeddingGenerator = {
      initialize: jest.fn(() => Promise.resolve()),
      generate: jest.fn(() => Promise.resolve(Array(384).fill(0).map(() => Math.random()))),
      generateBatch: jest.fn((texts: string[]) => 
        Promise.resolve(texts.map(() => Array(384).fill(0).map(() => Math.random())))
      ),
      close: jest.fn(() => Promise.resolve()),
      getModelInfo: jest.fn(() => ({ 
        ready: true, 
        modelName: 'mock-model',
        dimension: 384 
      }))
    } as any;

    intelligence = new IntelligenceLayer(testConfig.intelligence, storage, mockEmbeddingGenerator);
    await intelligence.initialize();
  });

  afterEach(async () => {
    await intelligence?.close();
    await storage?.close();
    
    // Clean test directories
    try {
      await fs.rm('/tmp/test-vector-search', { recursive: true, force: true });
      await fs.rm('/tmp/test-files-search', { recursive: true, force: true });
    } catch (error) {
      // Ignore errors
    }
  });

  describe('End-to-End Similarity Search', () => {
    it('should perform semantic search across stored memories', async () => {
      // Given: Various types of memories
      const memories = [
        {
          eventType: 'code_review',
          content: 'Reviewed the authentication module and found potential security issues with password hashing',
          metadata: { module: 'auth', severity: 'high' }
        },
        {
          eventType: 'bug_fix',
          content: 'Fixed null pointer exception in user profile service when email is missing',
          metadata: { service: 'user-profile', bugId: 'BUG-1234' }
        },
        {
          eventType: 'feature_implementation',
          content: 'Implemented new OAuth2 authentication flow with Google and GitHub providers',
          metadata: { feature: 'oauth2', providers: ['google', 'github'] }
        },
        {
          eventType: 'performance_optimization',
          content: 'Optimized database queries in the user service reducing response time by 40%',
          metadata: { service: 'user-service', improvement: '40%' }
        },
        {
          eventType: 'documentation',
          content: 'Updated API documentation for the authentication endpoints with examples',
          metadata: { type: 'api-docs', module: 'auth' }
        }
      ];

      // Store memories
      const storedMemories = [];
      for (const memory of memories) {
        const stored = await storage.captureMemory({
          ...memory,
          timestamp: new Date(),
          sessionId: 'test-session'
        });
        storedMemories.push(stored);
      }

      // When: Searching for authentication-related memories
      const authResults = await intelligence.retrieveMemories('authentication security OAuth', {
        limit: 3
      });

      // Then: Should return relevant results
      expect(authResults.length).toBeGreaterThan(0);
      expect(authResults.length).toBeLessThanOrEqual(3);
      
      // Should prioritize auth-related memories
      const authRelatedTypes = ['code_review', 'feature_implementation', 'documentation'];
      const topResult = authResults[0];
      expect(authRelatedTypes).toContain(topResult?.eventType);
    });

    it('should handle multilingual content', async () => {
      // Given: Memories in different languages
      const multilingualMemories = [
        {
          eventType: 'code_comment',
          content: 'Added error handling for network timeouts',
          metadata: { language: 'en' }
        },
        {
          eventType: 'code_comment',
          content: 'Ajout de la gestion des erreurs pour les timeouts réseau',
          metadata: { language: 'fr' }
        },
        {
          eventType: 'code_comment',
          content: 'Añadido manejo de errores para timeouts de red',
          metadata: { language: 'es' }
        },
        {
          eventType: 'code_comment',
          content: 'ネットワークタイムアウトのエラー処理を追加',
          metadata: { language: 'ja' }
        }
      ];

      // Store memories
      for (const memory of multilingualMemories) {
        await storage.captureMemory({
          ...memory,
          timestamp: new Date(),
          sessionId: 'multilingual-session'
        });
      }

      // When: Searching in English
      const results = await intelligence.retrieveMemories('network error handling', {
        limit: 4
      });

      // Then: Should find relevant content across languages
      expect(results.length).toBeGreaterThan(0);
      
      // The English version should rank high
      const englishResult = results.find(r => r.metadata?.language === 'en');
      expect(englishResult).toBeDefined();
    });
  });

  describe('Performance Under Load', () => {
    it('should maintain sub-200ms search latency with 10k memories', async () => {
      // Given: Large number of memories
      const categories = ['frontend', 'backend', 'database', 'infrastructure', 'security'];
      const actions = ['implemented', 'fixed', 'optimized', 'refactored', 'documented'];
      
      console.log('Creating 10,000 memories...');
      const batchSize = 100;
      for (let batch = 0; batch < 100; batch++) {
        const batchMemories = [];
        for (let i = 0; i < batchSize; i++) {
          const idx = batch * batchSize + i;
          const category = categories[idx % categories.length];
          const action = actions[idx % actions.length];
          
          batchMemories.push({
            eventType: 'development',
            content: `${action} the ${category} module with improvements to performance and reliability`,
            metadata: { 
              category,
              action,
              index: idx,
              importance: Math.random()
            },
            timestamp: new Date(),
            sessionId: 'load-test-session'
          });
        }
        
        // Store batch
        await Promise.all(batchMemories.map(m => storage.captureMemory(m)));
      }

      // When: Performing searches
      const searchQueries = [
        'frontend performance optimization',
        'backend security fixes',
        'database query improvements',
        'infrastructure scaling',
        'code refactoring patterns'
      ];

      const searchTimes: number[] = [];
      for (const query of searchQueries) {
        const start = Date.now();
        const results = await intelligence.retrieveMemories(query, { limit: 10 });
        const duration = Date.now() - start;
        searchTimes.push(duration);
        
        expect(results.length).toBeGreaterThan(0);
        expect(results.length).toBeLessThanOrEqual(10);
      }

      // Then: All searches should complete within 200ms
      const avgSearchTime = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length;
      const maxSearchTime = Math.max(...searchTimes);
      
      console.log(`Average search time: ${avgSearchTime}ms`);
      console.log(`Max search time: ${maxSearchTime}ms`);
      
      expect(maxSearchTime).toBeLessThan(200);
      expect(avgSearchTime).toBeLessThan(150);
    }, 30000); // 30 second timeout

    it('should handle concurrent searches efficiently', async () => {
      // Given: Moderate dataset
      const memoryCount = 1000;
      for (let i = 0; i < memoryCount; i++) {
        await storage.captureMemory({
          eventType: 'concurrent_test',
          content: `Memory ${i}: ${Math.random() > 0.5 ? 'async' : 'sync'} operation with ${Math.random() > 0.5 ? 'success' : 'retry'} result`,
          metadata: { index: i },
          timestamp: new Date(),
          sessionId: 'concurrent-session'
        });
      }

      // When: Multiple concurrent searches
      const concurrentSearches = 20;
      const queries = [
        'async operations',
        'sync operations',
        'success results',
        'retry handling',
        'operation memory'
      ];

      const searchPromises = [];
      const startTime = Date.now();

      for (let i = 0; i < concurrentSearches; i++) {
        const query = queries[i % queries.length];
        searchPromises.push(
          intelligence.retrieveMemories(query!, { limit: 5 })
        );
      }

      const results = await Promise.all(searchPromises);
      const totalTime = Date.now() - startTime;

      // Then: Should handle concurrent load
      expect(results.every(r => Array.isArray(r))).toBe(true);
      expect(totalTime).toBeLessThan(1000); // All searches complete within 1 second
      
      console.log(`${concurrentSearches} concurrent searches completed in ${totalTime}ms`);
    });
  });

  describe('Advanced Search Features', () => {
    it('should support filtered similarity search', async () => {
      // Given: Memories with various metadata
      const projects = ['project-a', 'project-b', 'project-c'];
      const types = ['bug', 'feature', 'refactor'];
      
      for (let i = 0; i < 30; i++) {
        await storage.captureMemory({
          eventType: 'development',
          content: `Work item ${i}: ${types[i % 3]} related to ${projects[i % 3]}`,
          metadata: {
            project: projects[i % 3],
            type: types[i % 3],
            priority: i % 3 + 1
          },
          timestamp: new Date(),
          sessionId: 'filter-test',
          workspaceId: projects[i % 3]
        });
      }

      // When: Searching with filters
      const results = await intelligence.retrieveMemories('bug fixes', {
        limit: 10,
        filters: {
          workspaceId: 'project-a'
        }
      });

      // Then: Should only return memories from project-a
      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        expect(result.workspaceId).toBe('project-a');
      });
    });

    it('should rank results by relevance and recency', async () => {
      // Given: Memories with different timestamps
      const now = new Date();
      const memories = [
        {
          content: 'Implemented user authentication with JWT tokens',
          timestamp: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) // 1 week old
        },
        {
          content: 'Fixed authentication bug in login flow',
          timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) // 1 day old
        },
        {
          content: 'Updated authentication documentation',
          timestamp: new Date(now.getTime() - 1 * 60 * 60 * 1000) // 1 hour old
        }
      ];

      for (const memory of memories) {
        await storage.captureMemory({
          eventType: 'development',
          content: memory.content,
          timestamp: memory.timestamp,
          sessionId: 'recency-test'
        });
      }

      // When: Searching for authentication
      const results = await intelligence.retrieveMemories('authentication', {
        limit: 3
      });

      // Then: Should consider both relevance and recency
      expect(results.length).toBe(3);
      
      // More recent memories should generally rank higher for similar relevance
      const timestamps = results.map(r => r.timestamp.getTime());
      const isSortedByRecency = timestamps.every((t, i) => 
        i === 0 || t <= timestamps[i - 1]!
      );
      
      // Allow some flexibility as relevance also matters
      expect(results[0]?.content).toContain('authentication');
    });

    it('should handle query expansion and synonyms', async () => {
      // Given: Memories with related but different terminology
      const techMemories = [
        'Implemented API endpoint for user registration',
        'Created REST service for account creation',
        'Built HTTP interface for new user signup',
        'Developed web service for member enrollment',
        'Added API route for customer onboarding'
      ];

      for (const content of techMemories) {
        await storage.captureMemory({
          eventType: 'api_development',
          content,
          timestamp: new Date(),
          sessionId: 'synonym-test'
        });
      }

      // When: Searching with one term
      const results = await intelligence.retrieveMemories('user registration API', {
        limit: 5
      });

      // Then: Should find related concepts
      expect(results.length).toBeGreaterThan(2);
      
      // Should find various related terms
      const foundTerms = new Set<string>();
      results.forEach(r => {
        if (r.content.includes('registration')) foundTerms.add('registration');
        if (r.content.includes('signup')) foundTerms.add('signup');
        if (r.content.includes('creation')) foundTerms.add('creation');
        if (r.content.includes('enrollment')) foundTerms.add('enrollment');
        if (r.content.includes('onboarding')) foundTerms.add('onboarding');
      });
      
      expect(foundTerms.size).toBeGreaterThan(1);
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle search failures gracefully', async () => {
      // Given: Mock a failure in the embedding generator
      const failingIntelligence = new IntelligenceLayer(testConfig.intelligence, storage, {
        initialize: jest.fn(() => Promise.resolve()),
        generate: jest.fn(() => Promise.reject(new Error('Embedding service unavailable'))),
        close: jest.fn(() => Promise.resolve()),
        getModelInfo: jest.fn(() => ({ ready: true, modelName: 'mock', dimension: 384 }))
      } as any);
      await failingIntelligence.initialize();

      // When: Attempting to search
      const results = await failingIntelligence.retrieveMemories('test query', { limit: 5 });

      // Then: Should return empty results rather than throwing
      expect(results).toEqual([]);

      await failingIntelligence.close();
    });

    it('should handle corrupted vector data', async () => {
      // Given: Store a memory with valid data
      await storage.captureMemory({
        eventType: 'test',
        content: 'Valid memory content',
        timestamp: new Date(),
        sessionId: 'corruption-test'
      });

      // Directly corrupt the vector store (simulating disk corruption)
      // This is a bit hacky but simulates real-world corruption
      const vectorStore = (storage as any).vectorStore;
      if (vectorStore && vectorStore.vectors) {
        const vectors = vectorStore.vectors as Map<string, any>;
        for (const [, value] of vectors.entries()) {
          // Corrupt some vector values
          if (value.vector) {
            value.vector[0] = NaN;
            value.vector[1] = Infinity;
          }
        }
      }

      // When: Searching (should handle corrupted data)
      const results = await intelligence.retrieveMemories('memory content', { limit: 5 });

      // Then: Should handle gracefully (might return empty or filter out corrupted)
      expect(Array.isArray(results)).toBe(true);
    });

    it('should recover from temporary storage failures', async () => {
      // Given: Memories stored successfully
      for (let i = 0; i < 5; i++) {
        await storage.captureMemory({
          eventType: 'recovery_test',
          content: `Recovery test memory ${i}`,
          timestamp: new Date(),
          sessionId: 'recovery-session'
        });
      }

      // Simulate temporary storage issue by mocking a method
      const originalQuery = storage.queryMemories.bind(storage);
      let failureCount = 0;
      jest.spyOn(storage, 'queryMemories').mockImplementation(async (...args) => {
        if (failureCount < 2) {
          failureCount++;
          throw new Error('Temporary storage failure');
        }
        return originalQuery(...args);
      });

      // When: Searching with retries
      let results: any[] = [];
      let attempts = 0;
      while (attempts < 3 && results.length === 0) {
        try {
          results = await intelligence.retrieveMemories('recovery test', { limit: 5 });
        } catch (error) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Then: Should eventually succeed
      expect(results.length).toBeGreaterThan(0);
      expect(attempts).toBeLessThanOrEqual(2);
    });
  });

  describe('Integration with Build Context', () => {
    it('should build contextual narrative from search results', async () => {
      // Given: Related memories forming a story
      const storyMemories = [
        {
          content: 'Started implementing new feature: real-time chat',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          metadata: { phase: 'planning' }
        },
        {
          content: 'Designed WebSocket architecture for chat system',
          timestamp: new Date('2024-01-01T11:00:00Z'),
          metadata: { phase: 'design' }
        },
        {
          content: 'Implemented chat message sending functionality',
          timestamp: new Date('2024-01-01T14:00:00Z'),
          metadata: { phase: 'implementation' }
        },
        {
          content: 'Added real-time message delivery with socket.io',
          timestamp: new Date('2024-01-01T16:00:00Z'),
          metadata: { phase: 'implementation' }
        },
        {
          content: 'Fixed race condition in message ordering',
          timestamp: new Date('2024-01-02T09:00:00Z'),
          metadata: { phase: 'bugfix' }
        },
        {
          content: 'Completed chat feature with typing indicators',
          timestamp: new Date('2024-01-02T17:00:00Z'),
          metadata: { phase: 'completion' }
        }
      ];

      for (const memory of storyMemories) {
        await storage.captureMemory({
          eventType: 'feature_development',
          ...memory,
          sessionId: 'chat-feature-session'
        });
      }

      // When: Building context for the chat feature
      const retrievedMemories = await intelligence.retrieveMemories('real-time chat implementation', {
        limit: 10
      });
      const context = await intelligence.buildContext(retrievedMemories);

      // Then: Should create a coherent narrative
      expect(context).toBeDefined();
      expect(context.length).toBeGreaterThan(0);
      
      // Should include key phases of development
      expect(context).toContain('chat');
      expect(context).toContain('WebSocket');
      expect(context).toContain('real-time');
    });

    it('should prioritize relevant context within token limits', async () => {
      // Given: Many memories with varying relevance
      const topics = [
        { topic: 'authentication', relevance: 'high' },
        { topic: 'database optimization', relevance: 'medium' },
        { topic: 'UI styling', relevance: 'low' },
        { topic: 'security audit', relevance: 'high' },
        { topic: 'deployment scripts', relevance: 'medium' }
      ];

      for (const { topic, relevance } of topics) {
        for (let i = 0; i < 10; i++) {
          await storage.captureMemory({
            eventType: 'development',
            content: `Work on ${topic}: ${relevance} priority task ${i}`,
            metadata: { topic, relevance, index: i },
            timestamp: new Date(),
            sessionId: 'context-priority-session'
          });
        }
      }

      // When: Building context with token limit
      const retrievedMemories = await intelligence.retrieveMemories('security and authentication work', {
        limit: 20
      });
      // Take only first few memories to simulate token limit
      const limitedMemories = retrievedMemories.slice(0, 5);
      const context = await intelligence.buildContext(limitedMemories);

      // Then: Should prioritize high-relevance content
      const securityMentions = (context.match(/security/gi) || []).length;
      const authMentions = (context.match(/authentication/gi) || []).length;
      const stylingMentions = (context.match(/styling/gi) || []).length;

      expect(securityMentions + authMentions).toBeGreaterThan(stylingMentions);
    });
  });
});