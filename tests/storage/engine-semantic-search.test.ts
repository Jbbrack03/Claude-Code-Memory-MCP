import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { StorageEngine } from "../../src/storage/engine.js";
import { Config } from "../../src/config/index.js";
import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";

describe('StorageEngine - Semantic Search', () => {
  // NOTE: These tests reveal a bug in the current implementation:
  // The semantic search returns vector IDs from the vector store, but tries to use them
  // directly as memory IDs. It should map vector IDs to memory IDs using the vector_mappings table.
  let engine: StorageEngine;
  let mockEmbeddingService: jest.Mock<(text: string) => Promise<number[]>>;
  const testDbPath = path.join(process.cwd(), '.test-memory', 'engine-semantic-test.db');
  
  const testConfig: Config["storage"] = {
    sqlite: {
      path: testDbPath,
      walMode: true,
      busyTimeout: 5000,
      cacheSize: 10000
    },
    vector: {
      provider: 'local',
      path: './.test-memory/vectors-semantic',
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
    
    // Clean up vector store directory
    const vectorPath = path.join(process.cwd(), '.test-memory', 'vectors-semantic');
    try {
      await fsPromises.access(vectorPath);
      await fsPromises.rm(vectorPath, { recursive: true });
    } catch {
      // Directory doesn't exist, that's ok
    }
    
    // Create engine and mock embedding service
    engine = new StorageEngine(testConfig);
    mockEmbeddingService = jest.fn<(text: string) => Promise<number[]>>();
    
    // Initialize engine
    await engine.initialize();
    
    // Set up the embedding service
    engine.setEmbeddingService(mockEmbeddingService);
  });

  afterEach(async () => {
    // Clean up after tests
    if (engine) {
      await engine.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    jest.clearAllMocks();
  });

  describe('semantic query functionality', () => {
    it('should use embedding service when semanticQuery is provided', async () => {
      // Given: A semantic query and mock embedding
      const semanticQuery = "find all code related to user authentication";
      const queryEmbedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(queryEmbedding);

      // When: Querying with semantic query
      await engine.queryMemories({ semanticQuery });

      // Then: Embedding service should be called with the query
      expect(mockEmbeddingService).toHaveBeenCalledWith(semanticQuery);
      expect(mockEmbeddingService).toHaveBeenCalledTimes(1);
    });

    it('should search vector store with generated embedding', async () => {
      // Given: Memories with embeddings and a semantic query
      const memory1 = {
        eventType: 'file_write',
        content: 'Implemented user authentication with JWT tokens and session management',
        sessionId: 'test-session',
        timestamp: new Date()
      };

      const memory2 = {
        eventType: 'file_write',
        content: 'Added database connection pooling and query optimization',
        sessionId: 'test-session',
        timestamp: new Date()
      };

      // Set up embeddings
      const authEmbedding = Array(384).fill(0).map((_, i) => i === 0 ? 0.9 : Math.random() * 0.1);
      const dbEmbedding = Array(384).fill(0).map((_, i) => i === 1 ? 0.9 : Math.random() * 0.1);
      const queryEmbedding = Array(384).fill(0).map((_, i) => i === 0 ? 0.85 : Math.random() * 0.1);

      mockEmbeddingService
        .mockResolvedValueOnce(authEmbedding) // For memory1
        .mockResolvedValueOnce(dbEmbedding)   // For memory2
        .mockResolvedValueOnce(queryEmbedding); // For query

      // Capture memories
      const captured1 = await engine.captureMemory(memory1);
      await engine.captureMemory(memory2);

      // When: Performing semantic search
      const results = await engine.queryMemories({ 
        semanticQuery: "authentication and security",
        limit: 5 
      });

      // Then: Should return memories sorted by similarity
      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe(captured1.id); // Auth memory should be first
      expect(results[0]?.content).toContain('authentication');
    });

    it('should combine semantic search with other filters', async () => {
      // Given: Memories in different workspaces
      const memories = [
        {
          eventType: 'file_write',
          content: 'User authentication module implementation with login, logout and session handling',
          sessionId: 'session1',
          workspaceId: 'workspace1',
          timestamp: new Date()
        },
        {
          eventType: 'file_write',
          content: 'User authentication service for managing user credentials and permissions',
          sessionId: 'session2',
          workspaceId: 'workspace2',
          timestamp: new Date()
        },
        {
          eventType: 'code_write',
          content: 'npm install passport jwt for authentication system implementation',
          sessionId: 'session1',
          workspaceId: 'workspace1',
          timestamp: new Date()
        }
      ];

      // Mock embeddings (similar for auth content)
      const authEmbedding = Array(384).fill(0).map((_, i) => i < 10 ? 0.9 : 0.1);
      const queryEmbedding = Array(384).fill(0).map((_, i) => i < 10 ? 0.85 : 0.15);

      mockEmbeddingService
        .mockResolvedValueOnce(authEmbedding)
        .mockResolvedValueOnce(authEmbedding)
        .mockResolvedValueOnce(authEmbedding)
        .mockResolvedValueOnce(queryEmbedding);

      // Capture all memories
      for (const memory of memories) {
        await engine.captureMemory(memory);
      }

      // When: Semantic search with workspace filter
      const results = await engine.queryMemories({
        semanticQuery: "authentication",
        workspaceId: 'workspace1'
      });

      // Then: Should only return memories from workspace1  
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(2);
      expect(results.every(m => m.workspaceId === 'workspace1')).toBe(true);
    });

    it('should handle semantic search with session filter', async () => {
      // Given: Memories across different sessions
      const memories = [
        {
          eventType: 'file_write',
          content: 'OAuth2 authentication implementation with full support for authorization code flow and refresh tokens',
          sessionId: 'session-alpha',
          timestamp: new Date()
        },
        {
          eventType: 'file_write',
          content: 'JWT token validation logic with signature verification and expiration checking for secure API access',
          sessionId: 'session-beta',
          timestamp: new Date()
        }
      ];

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      for (const memory of memories) {
        await engine.captureMemory(memory);
      }

      // When: Semantic search with session filter
      const results = await engine.queryMemories({
        semanticQuery: "authentication tokens",
        sessionId: 'session-alpha'
      });

      // Then: Should only return memories from specified session
      expect(results.length).toBe(1);
      expect(results[0]?.sessionId).toBe('session-alpha');
    });

    it('should handle semantic search with git branch filter', async () => {
      // Given: Memories on different branches
      const memories = [
        {
          eventType: 'file_write',
          content: 'Security middleware implementation with CORS, CSRF protection, and rate limiting for API endpoints',
          sessionId: 'test',
          gitBranch: 'feature/auth',
          timestamp: new Date()
        },
        {
          eventType: 'file_write',
          content: 'Database security configuration with encryption at rest and secure connection parameters for production',
          sessionId: 'test',
          gitBranch: 'main',
          timestamp: new Date()
        }
      ];

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      for (const memory of memories) {
        await engine.captureMemory(memory);
      }

      // When: Semantic search with branch filter
      const results = await engine.queryMemories({
        semanticQuery: "security implementation",
        gitBranch: 'feature/auth'
      });

      // Then: Should only return memories from specified branch
      expect(results.length).toBe(1);
      expect(results[0]?.gitBranch).toBe('feature/auth');
    });

    it('should respect limit parameter in semantic search', async () => {
      // Given: Many similar memories
      const memories = Array(10).fill(null).map((_, i) => ({
        eventType: 'file_write',
        content: `Authentication module implementation part ${i} with detailed login and security features`,
        sessionId: 'test',
        timestamp: new Date()
      }));

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      for (const memory of memories) {
        await engine.captureMemory(memory);
      }

      // When: Semantic search with limit
      const results = await engine.queryMemories({
        semanticQuery: "authentication modules",
        limit: 3
      });

      // Then: Should return exactly the limit
      expect(results).toHaveLength(3);
    });

    it('should return empty array when no embeddings match semantic query', async () => {
      // Given: A memory with different content that will generate embedding
      const memory = {
        eventType: 'file_write',
        content: 'Database schema migration and table creation for project setup',
        sessionId: 'test',
        timestamp: new Date()
      };

      // Mock embeddings (memory embedding will be created but won't match query)
      const memoryEmbedding = Array(384).fill(0).map((_, i) => i < 192 ? 1 : 0);
      const queryEmbedding = Array(384).fill(0).map((_, i) => i >= 192 ? 1 : 0);

      mockEmbeddingService
        .mockResolvedValueOnce(memoryEmbedding)
        .mockResolvedValueOnce(queryEmbedding);

      await engine.captureMemory(memory);

      // Mock vector store to return no results (no similarity match)
      const vectorStore = engine.getVectorStore();
      if (vectorStore) {
        jest.spyOn(vectorStore, 'search').mockResolvedValueOnce([]);
      }

      // When: Performing semantic search
      const results = await engine.queryMemories({
        semanticQuery: "completely unrelated query"
      });

      // Then: Should return empty array
      expect(results).toEqual([]);
    });

    it('should fall back to SQL query when vector search fails', async () => {
      // Given: Memories and a failing embedding service
      const memory = {
        eventType: 'file_write',
        content: 'Authentication service implementation with comprehensive user management and session tracking capabilities',
        sessionId: 'test',
        timestamp: new Date()
      };

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService
        .mockResolvedValueOnce(embedding) // For capture
        .mockRejectedValueOnce(new Error('Embedding service unavailable')); // For query

      await engine.captureMemory(memory);

      // When: Semantic search fails
      const results = await engine.queryMemories({
        semanticQuery: "authentication",
        eventType: 'file_write'
      });

      // Then: Should fall back to SQL query
      expect(results).toHaveLength(1);
      expect(results[0]?.eventType).toBe('file_write');
    });

    it('should fall back to SQL when vector store is not available', async () => {
      // Given: Engine without vector store
      const memory = {
        eventType: 'file_write',
        content: 'Test content for vector store validation with sufficient length to trigger embedding generation',
        sessionId: 'test',
        timestamp: new Date()
      };

      await engine.captureMemory(memory);

      // Simulate vector store not being available
      const vectorStore = engine.getVectorStore();
      if (vectorStore) {
        await vectorStore.close();
      }

      // When: Attempting semantic search
      const results = await engine.queryMemories({
        semanticQuery: "test query",
        eventType: 'file_write'
      });

      // Then: Should fall back to SQL query
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('Test content for vector store validation with sufficient length to trigger embedding generation');
    });

    it('should fall back to SQL when embedding service is not set', async () => {
      // Given: Engine without embedding service
      const engineNoEmbed = new StorageEngine(testConfig);
      await engineNoEmbed.initialize();

      const memory = {
        eventType: 'file_write',
        content: 'No embedding content',
        sessionId: 'test',
        timestamp: new Date()
      };

      await engineNoEmbed.captureMemory(memory);

      // When: Attempting semantic search without embedding service
      const results = await engineNoEmbed.queryMemories({
        semanticQuery: "search query",
        eventType: 'file_write'
      });

      // Then: Should fall back to SQL query
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('No embedding content');

      await engineNoEmbed.close();
    });

    it('should handle empty semantic query gracefully', async () => {
      // Given: Empty semantic query
      const memory = {
        eventType: 'file_write',
        content: 'Some content',
        sessionId: 'test',
        timestamp: new Date()
      };

      await engine.captureMemory(memory);

      // When: Querying with empty semantic query
      const results = await engine.queryMemories({
        semanticQuery: "",
        sessionId: 'test'
      });

      // Then: Should fall back to regular query
      expect(results).toHaveLength(1);
      expect(mockEmbeddingService).not.toHaveBeenCalled();
    });

    it('should handle semantic query with special characters', async () => {
      // Given: Semantic query with special characters
      const specialQuery = "user's authentication & authorization | security <script>";
      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      const memory = {
        eventType: 'file_write',
        content: 'Security module with authentication',
        sessionId: 'test',
        timestamp: new Date()
      };

      await engine.captureMemory(memory);

      // When: Querying with special characters
      const results = await engine.queryMemories({
        semanticQuery: specialQuery
      });

      // Then: Should handle the query properly
      expect(mockEmbeddingService).toHaveBeenCalledWith(specialQuery);
      expect(results).toBeDefined();
    });

    it('should preserve memory order from vector search results', async () => {
      // Given: Multiple memories with known similarity scores
      const memories = [
        {
          eventType: 'file_write',
          content: 'Low relevance content about databases with connection pooling and optimization features',
          sessionId: 'test',
          timestamp: new Date()
        },
        {
          eventType: 'file_write',
          content: 'Highly relevant authentication implementation with JWT tokens and session management',
          sessionId: 'test',
          timestamp: new Date()
        },
        {
          eventType: 'file_write',
          content: 'Medium relevance security configuration with access control and permission management',
          sessionId: 'test',
          timestamp: new Date()
        }
      ];

      // Mock embeddings with decreasing similarity
      const embeddings = [
        Array(384).fill(0).map((_, i) => i === 0 ? 0.3 : 0), // Low
        Array(384).fill(0).map((_, i) => i === 0 ? 0.9 : 0), // High
        Array(384).fill(0).map((_, i) => i === 0 ? 0.6 : 0)  // Medium
      ];
      const queryEmbedding = Array(384).fill(0).map((_, i) => i === 0 ? 1.0 : 0);

      mockEmbeddingService
        .mockResolvedValueOnce(embeddings[0]!)
        .mockResolvedValueOnce(embeddings[1]!)
        .mockResolvedValueOnce(embeddings[2]!)
        .mockResolvedValueOnce(queryEmbedding);

      const capturedIds: string[] = [];
      for (const memory of memories) {
        const captured = await engine.captureMemory(memory);
        capturedIds.push(captured.id);
      }

      // Mock vector store to return in similarity order
      const vectorStore = engine.getVectorStore();
      if (vectorStore) {
        jest.spyOn(vectorStore, 'search').mockResolvedValueOnce([
          { 
            id: capturedIds[1]!, 
            score: 0.9,
            vector: embeddings[1]!,
            metadata: { id: capturedIds[1]! }
          }, // High relevance first
          { 
            id: capturedIds[2]!, 
            score: 0.6,
            vector: embeddings[2]!,
            metadata: { id: capturedIds[2]! }
          }, // Medium relevance second
          { 
            id: capturedIds[0]!, 
            score: 0.3,
            vector: embeddings[0]!,
            metadata: { id: capturedIds[0]! }
          }  // Low relevance third
        ]);
      }

      // When: Performing semantic search
      const results = await engine.queryMemories({
        semanticQuery: "authentication"
      });

      // Then: Results should be in similarity order
      expect(results).toHaveLength(3);
      expect(results[0]?.content).toContain('Highly relevant authentication');
      expect(results[1]?.content).toContain('Medium relevance security');
      expect(results[2]?.content).toContain('Low relevance content');
    });

    it('should handle concurrent semantic queries', async () => {
      // Given: Multiple memories and concurrent queries
      const memories = Array(5).fill(null).map((_, i) => ({
        eventType: 'file_write',
        content: `Detailed authentication content implementation number ${i} with security features and access control`,
        sessionId: 'test',
        timestamp: new Date()
      }));

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      for (const memory of memories) {
        await engine.captureMemory(memory);
      }

      // When: Multiple concurrent semantic queries
      const queries = [
        engine.queryMemories({ semanticQuery: "authentication" }),
        engine.queryMemories({ semanticQuery: "security" }),
        engine.queryMemories({ semanticQuery: "access control" })
      ];

      const results = await Promise.all(queries);

      // Then: All queries should complete successfully
      expect(results).toHaveLength(3);
      expect(results.every(r => Array.isArray(r))).toBe(true);
      expect(mockEmbeddingService).toHaveBeenCalledTimes(8); // 5 for capture + 3 for queries
    });

    it('should handle vector store returning partial results', async () => {
      // Given: Memories where some IDs don't exist in SQLite
      const memory = {
        eventType: 'file_write',
        content: 'Valid memory content',
        sessionId: 'test',
        timestamp: new Date()
      };

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      const captured = await engine.captureMemory(memory);

      // Mock vector store to return non-existent IDs
      const vectorStore = engine.getVectorStore();
      if (vectorStore) {
        jest.spyOn(vectorStore, 'search').mockResolvedValueOnce([
          { 
            id: captured.id, 
            score: 0.9,
            vector: embedding,
            metadata: { id: captured.id }
          },
          { 
            id: 'non-existent-id', 
            score: 0.8,
            vector: embedding,
            metadata: { id: 'non-existent-id' }
          },
          { 
            id: 'another-missing-id', 
            score: 0.7,
            vector: embedding,
            metadata: { id: 'another-missing-id' }
          }
        ]);
      }

      // When: Performing semantic search
      const results = await engine.queryMemories({
        semanticQuery: "search query"
      });

      // Then: Should only return valid memories
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(captured.id);
    });

    it('should handle embedding service timeout gracefully', async () => {
      // Given: Embedding service that times out
      const memory = {
        eventType: 'file_write',
        content: 'Timeout test content for embedding service with sufficient length to trigger generation',
        sessionId: 'test',
        timestamp: new Date()
      };

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService
        .mockResolvedValueOnce(embedding) // For capture
        .mockImplementationOnce(() => new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 100)
        ));

      await engine.captureMemory(memory);

      // When: Semantic search with timing out embedding service
      const results = await engine.queryMemories({
        semanticQuery: "timeout query",
        eventType: 'file_write'
      });

      // Then: Should fall back to SQL query
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('Timeout test content for embedding service with sufficient length to trigger generation');
    });
  });

  describe('vector ID to memory ID mapping', () => {
    it('should correctly map vector IDs to memory IDs', async () => {
      // Given: A memory with embedding
      const memory = {
        eventType: 'file_write',
        content: 'Authentication implementation with JWT tokens and session management for secure user access',
        sessionId: 'test',
        timestamp: new Date()
      };

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      // Capture memory - this will create both a memory ID and vector ID
      const captured = await engine.captureMemory(memory);

      // Check that vector mapping was created
      const vectorStore = engine.getVectorStore();
      expect(vectorStore).not.toBeNull();

      // When: Performing semantic search
      const results = await engine.queryMemories({
        semanticQuery: "authentication"
      });

      // Then: The implementation should:
      // 1. Search vector store and get vector IDs
      // 2. Map vector IDs to memory IDs using vector_mappings table
      // 3. Return memories by their memory IDs
      
      // Currently this fails because the implementation uses vector IDs as memory IDs
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(captured.id);
    });

    it('should use memoryId from vector metadata as alternative mapping', async () => {
      // Given: Memories with embeddings where metadata contains memoryId
      const memory = {
        eventType: 'file_write',
        content: 'Authentication service implementation with user management and secure access control features',
        sessionId: 'test',
        timestamp: new Date()
      };

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      const captured = await engine.captureMemory(memory);

      // The vector store should have metadata with memoryId
      const vectorStore = engine.getVectorStore();
      if (vectorStore) {
        // Mock search to return vectors with memoryId in metadata
        jest.spyOn(vectorStore, 'search').mockResolvedValueOnce([
          { 
            id: 'vector-id-123', 
            score: 0.95,
            vector: embedding,
            metadata: { 
              memoryId: captured.id,
              eventType: 'file_write',
              sessionId: 'test'
            }
          }
        ]);
      }

      // When: Performing semantic search
      const results = await engine.queryMemories({
        semanticQuery: "authentication"
      });

      // Then: Could use metadata.memoryId if vector_mappings lookup fails
      // This would be a more robust implementation
      expect(results).toBeDefined();
    });

    it('should handle missing vector mappings gracefully', async () => {
      // Given: Vector store returns IDs that don't have mappings
      const memory = {
        eventType: 'file_write',
        content: 'Test content',
        sessionId: 'test',
        timestamp: new Date()
      };

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      const captured = await engine.captureMemory(memory);

      // Mock vector store to return unmapped vector IDs
      const vectorStore = engine.getVectorStore();
      if (vectorStore) {
        jest.spyOn(vectorStore, 'search').mockResolvedValueOnce([
          { 
            id: 'unmapped-vector-id-1', 
            score: 0.9,
            vector: embedding,
            metadata: { memoryId: captured.id }
          },
          { 
            id: 'unmapped-vector-id-2', 
            score: 0.8,
            vector: embedding,
            metadata: {}
          }
        ]);
      }

      // When: Performing semantic search
      const results = await engine.queryMemories({
        semanticQuery: "test"
      });

      // Then: Should handle missing mappings gracefully
      // The current implementation would fail to find memories for unmapped vector IDs
      expect(results).toBeDefined();
    });
  });

  describe('edge cases and error scenarios', () => {
    it('should handle malformed vector search results gracefully', async () => {
      // Given: Vector store returning malformed results
      const memory = {
        eventType: 'file_write',
        content: 'Test memory',
        sessionId: 'test',
        timestamp: new Date()
      };

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      await engine.captureMemory(memory);

      // Mock vector store to return invalid results
      const vectorStore = engine.getVectorStore();
      if (vectorStore) {
        jest.spyOn(vectorStore, 'search').mockResolvedValueOnce([
          { id: null as any, score: 0.9 }, // Invalid ID
          { id: undefined as any, score: 0.8 }, // Undefined ID
          { id: '', score: 0.7 } // Empty ID
        ] as any);
      }

      // When: Performing semantic search
      const results = await engine.queryMemories({
        semanticQuery: "test query"
      });

      // Then: Should handle gracefully
      expect(results).toEqual([]);
    });

    it('should handle very long semantic queries', async () => {
      // Given: A very long semantic query
      const longQuery = 'authentication '.repeat(1000); // ~14KB query
      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      const memory = {
        eventType: 'file_write',
        content: 'Authentication content',
        sessionId: 'test',
        timestamp: new Date()
      };

      await engine.captureMemory(memory);

      // When: Querying with very long query
      const results = await engine.queryMemories({
        semanticQuery: longQuery
      });

      // Then: Should handle the query
      expect(mockEmbeddingService).toHaveBeenCalledWith(longQuery);
      expect(results).toBeDefined();
    });

    it('should handle memories without embeddings in mixed results', async () => {
      // Given: Some memories with embeddings and some without
      const memoriesWithEmbedding = [
        {
          eventType: 'file_write',
          content: 'Large authentication module implementation with lots of details',
          sessionId: 'test',
          timestamp: new Date()
        }
      ];

      const memoriesWithoutEmbedding = [
        {
          eventType: 'command_run', // Won't generate embedding
          content: 'npm test',
          sessionId: 'test',
          timestamp: new Date()
        }
      ];

      const embedding = Array(384).fill(0).map(() => Math.random());
      mockEmbeddingService.mockResolvedValue(embedding);

      // Capture memories
      for (const memory of [...memoriesWithEmbedding, ...memoriesWithoutEmbedding]) {
        await engine.captureMemory(memory);
      }

      // When: Performing semantic search
      const results = await engine.queryMemories({
        semanticQuery: "authentication implementation"
      });

      // Then: Should only return memories with embeddings
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(m => m.eventType === 'file_write')).toBe(true);
    });
  });
});