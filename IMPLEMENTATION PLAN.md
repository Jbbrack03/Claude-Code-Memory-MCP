# Claude Code Memory MCP Server - Updated Implementation Plan

## Table of Contents

1. [Overview](#overview)
2. [Critical Issues Identified](#critical-issues-identified)
3. [Updated Implementation Phases](#updated-implementation-phases)
4. [Phase 1: Storage Engine Foundation](#phase-1-storage-engine-foundation) ✅
5. [Phase 2: Hook System Implementation](#phase-2-hook-system-implementation) ✅
6. [Phase 3: Git Integration](#phase-3-git-integration) ✅
7. [Phase 4: Intelligence Layer Core Components](#phase-4-intelligence-layer-core-components) ✅
8. [Phase 4.5: Intelligence Layer Integration](#phase-45-intelligence-layer-integration) ✅
9. [Phase 5: MCP Server Integration](#phase-5-mcp-server-integration) ✅
10. [Phase 6: Production Hardening](#phase-6-production-hardening)
11. [Phase 7: Performance Optimization](#phase-7-performance-optimization)
12. [Phase 8: Release Preparation](#phase-8-release-preparation)

## Overview

This updated implementation plan addresses critical gaps discovered during code review. The original plan failed to properly integrate Phase 4 components, leaving the core semantic search functionality non-operational.

### Critical Issues Identified

1. **IntelligenceLayer.retrieveMemories()** returns empty array - core feature broken
2. **No ContextBuilder implementation** - cannot format memories for injection
3. **No connection between stored embeddings and retrieval** - components work in isolation
4. **O(n) vector search** - won't scale beyond 10K vectors
5. **Over-engineered components** - complex features before basic functionality

### Updated Phase Timeline

- Phase 1-3: ✅ Complete (10 days)
- **Phase 4: Intelligence Layer Core Components (5 days)** ✅ COMPLETE
- **Phase 4.5: Intelligence Layer Integration (3 days)** ✅ COMPLETE
- **Phase 5: MCP Server Integration (3 days)** ✅ COMPLETE
- Phase 6: Production Hardening (4 days)
- Phase 7: Performance Optimization (3 days)
- Phase 8: Release Preparation (3 days)

## Phase 4: Intelligence Layer Core Components

### Current Status (COMPLETED v0.5.1)
- ✅ EmbeddingGenerator: Complete with 97% coverage
- ✅ VectorStore: Enhanced with similarity search, filtering, and batch operations
- ✅ ContextBuilder: Complete implementation with formatting and deduplication
- ✅ IntelligenceLayer: Full implementation with vector search, SQL fallback, and caching
- ✅ Bug Fixes: Query caching, test stability, TypeScript compilation

### 4.1 Complete IntelligenceLayer Implementation

#### Implementation Requirements

```typescript
// src/intelligence/layer.ts
import { createLogger } from "../utils/logger.js";
import type { Config } from "../config/index.js";
import { StorageEngine } from "../storage/engine.js";
import { EmbeddingGenerator } from "./embeddings.js";
import { ContextBuilder } from "./context-builder.js";
import type { VectorStore } from "../storage/vector-store.js";

const logger = createLogger("IntelligenceLayer");

export interface RetrievalOptions {
  limit?: number;
  filters?: Record<string, any>;
  minScore?: number;
  includeMetadata?: boolean;
}

export interface RetrievedMemory {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, any>;
  timestamp: Date;
  eventType?: string;
  sessionId?: string;
  workspaceId?: string;
  gitBranch?: string;
}

export class IntelligenceLayer {
  private config: Config["intelligence"];
  private initialized = false;
  private embeddingGenerator: EmbeddingGenerator;
  private contextBuilder: ContextBuilder;
  private storageEngine: StorageEngine;
  private queryCache: Map<string, RetrievedMemory[]> = new Map();

  constructor(
    config: Config["intelligence"],
    storageEngine: StorageEngine
  ) {
    this.config = config;
    this.storageEngine = storageEngine;
    this.embeddingGenerator = new EmbeddingGenerator({
      model: config.embeddings.model,
      batchSize: config.embeddings.batchSize,
      cache: config.embeddings.cache
    });
    this.contextBuilder = new ContextBuilder({
      maxSize: config.context.maxSize,
      includeMetadata: config.context.includeMetadata,
      deduplication: config.context.deduplication
    });
  }

  async initialize(): Promise<void> {
    logger.info("Initializing intelligence layer...");
    
    // Initialize embedding generator
    await this.embeddingGenerator.initialize();
    
    // Pass embedding service to storage engine
    this.storageEngine.setEmbeddingService(
      this.embeddingGenerator.generate.bind(this.embeddingGenerator)
    );
    
    this.initialized = true;
    logger.info("Intelligence layer initialized");
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.initialized) {
      throw new Error("Intelligence layer not initialized");
    }
    return await this.embeddingGenerator.generate(text);
  }

  async retrieveMemories(
    query: string, 
    options: RetrievalOptions = {}
  ): Promise<RetrievedMemory[]> {
    if (!this.initialized) {
      throw new Error("Intelligence layer not initialized");
    }

    const opts = {
      limit: options.limit || this.config.retrieval.topK,
      minScore: options.minScore || this.config.retrieval.minScore,
      includeMetadata: options.includeMetadata ?? this.config.context.includeMetadata,
      filters: options.filters || {}
    };

    logger.debug("Retrieving memories", { query, options: opts });
    
    // Check cache
    const cacheKey = JSON.stringify({ query, opts });
    if (this.queryCache.has(cacheKey)) {
      logger.debug("Cache hit for query");
      return this.queryCache.get(cacheKey)!;
    }
    
    try {
      // 1. Generate query embedding
      const queryEmbedding = await this.embeddingGenerator.generate(query);
      
      // 2. Get vector store reference from storage engine
      const vectorStore = await this.storageEngine.getVectorStore();
      if (!vectorStore) {
        logger.warn("Vector store not available, falling back to SQL search");
        return await this.fallbackSQLSearch(query, opts);
      }
      
      // 3. Search for similar vectors
      const vectorResults = await vectorStore.search(queryEmbedding, {
        k: opts.limit * 2, // Get more candidates for reranking
        threshold: opts.minScore,
        filter: opts.filters
      });
      
      // 4. Convert vector results to retrieved memories
      const memories: RetrievedMemory[] = vectorResults.map(result => ({
        id: result.id,
        content: result.metadata.content as string || "",
        score: result.score,
        metadata: result.metadata,
        timestamp: new Date(result.metadata.timestamp as string || Date.now()),
        eventType: result.metadata.eventType as string,
        sessionId: result.metadata.sessionId as string,
        workspaceId: result.metadata.workspaceId as string,
        gitBranch: result.metadata.gitBranch as string
      }));
      
      // 5. Rerank if enabled
      let finalMemories = memories;
      if (this.config.retrieval.rerank && memories.length > 0) {
        finalMemories = await this.rerankMemories(query, memories);
      }
      
      // 6. Limit to requested number
      finalMemories = finalMemories.slice(0, opts.limit);
      
      // 7. Cache results
      this.queryCache.set(cacheKey, finalMemories);
      
      // Limit cache size
      if (this.queryCache.size > 100) {
        const firstKey = this.queryCache.keys().next().value;
        if (firstKey) this.queryCache.delete(firstKey);
      }
      
      return finalMemories;
      
    } catch (error) {
      logger.error("Failed to retrieve memories", error);
      return await this.fallbackSQLSearch(query, opts);
    }
  }

  async buildContext(memories: RetrievedMemory[]): Promise<string> {
    if (!this.initialized) {
      throw new Error("Intelligence layer not initialized");
    }
    return await this.contextBuilder.build(memories);
  }

  async close(): Promise<void> {
    logger.info("Closing intelligence layer...");
    
    await this.embeddingGenerator.close();
    this.queryCache.clear();
    
    this.initialized = false;
    logger.info("Intelligence layer closed");
  }

  private async rerankMemories(
    query: string, 
    memories: RetrievedMemory[]
  ): Promise<RetrievedMemory[]> {
    // Simple reranking based on metadata relevance
    // In production, use a cross-encoder model
    return memories.sort((a, b) => {
      let scoreA = a.score;
      let scoreB = b.score;
      
      // Boost recent memories
      const now = Date.now();
      const ageA = now - a.timestamp.getTime();
      const ageB = now - b.timestamp.getTime();
      const dayInMs = 24 * 60 * 60 * 1000;
      
      if (ageA < dayInMs) scoreA *= 1.2;
      if (ageB < dayInMs) scoreB *= 1.2;
      
      // Boost if query terms in metadata
      const queryTerms = query.toLowerCase().split(/\s+/);
      const metaA = JSON.stringify(a.metadata).toLowerCase();
      const metaB = JSON.stringify(b.metadata).toLowerCase();
      
      for (const term of queryTerms) {
        if (metaA.includes(term)) scoreA *= 1.1;
        if (metaB.includes(term)) scoreB *= 1.1;
      }
      
      return scoreB - scoreA;
    });
  }

  private async fallbackSQLSearch(
    query: string, 
    options: any
  ): Promise<RetrievedMemory[]> {
    // Fallback to keyword search in SQLite
    const memories = await this.storageEngine.queryMemories({
      ...options.filters,
      limit: options.limit
    });
    
    // Simple relevance scoring based on query terms
    const queryTerms = query.toLowerCase().split(/\s+/);
    
    return memories
      .map(memory => {
        const content = memory.content.toLowerCase();
        let score = 0;
        
        for (const term of queryTerms) {
          if (content.includes(term)) {
            score += 0.3;
          }
        }
        
        return {
          id: memory.id,
          content: memory.content,
          score: Math.min(score, 1.0),
          metadata: memory.metadata,
          timestamp: memory.timestamp,
          eventType: memory.eventType,
          sessionId: memory.sessionId,
          workspaceId: memory.workspaceId,
          gitBranch: memory.gitBranch
        };
      })
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);
  }
}
```

#### Test Specifications

```typescript
// tests/intelligence/layer.test.ts
describe('IntelligenceLayer', () => {
  let intelligence: IntelligenceLayer;
  let storage: StorageEngine;
  let vectorStore: VectorStore;

  beforeEach(async () => {
    // Setup with in-memory storage
    storage = new StorageEngine(testConfig.storage);
    await storage.initialize();
    
    intelligence = new IntelligenceLayer(testConfig.intelligence, storage);
    await intelligence.initialize();
    
    vectorStore = await storage.getVectorStore();
  });

  describe('retrieveMemories', () => {
    it('should retrieve relevant memories using vector search', async () => {
      // Given: Memories with embeddings
      await storage.captureMemory({
        eventType: 'code_write',
        content: 'Implemented user authentication with JWT tokens',
        sessionId: 'test-session',
        timestamp: new Date()
      });
      
      await storage.captureMemory({
        eventType: 'code_write',
        content: 'Added database connection pooling',
        sessionId: 'test-session',
        timestamp: new Date()
      });
      
      // When: Searching for related content
      const results = await intelligence.retrieveMemories('authentication JWT', {
        limit: 5
      });
      
      // Then: Relevant memory is retrieved
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('authentication');
      expect(results[0].score).toBeGreaterThan(0.7);
    });

    it('should apply filters during retrieval', async () => {
      // Given: Memories in different sessions
      await storage.captureMemory({
        eventType: 'test',
        content: 'Session 1 content',
        sessionId: 'session-1',
        timestamp: new Date()
      });
      
      await storage.captureMemory({
        eventType: 'test',
        content: 'Session 2 content',
        sessionId: 'session-2',
        timestamp: new Date()
      });
      
      // When: Filtering by session
      const results = await intelligence.retrieveMemories('content', {
        filters: { sessionId: 'session-1' }
      });
      
      // Then: Only matching session returned
      expect(results).toHaveLength(1);
      expect(results[0].sessionId).toBe('session-1');
    });

    it('should fall back to SQL search if vector store unavailable', async () => {
      // Given: Vector store is unavailable
      jest.spyOn(storage, 'getVectorStore').mockResolvedValue(null);
      
      // When: Searching
      const results = await intelligence.retrieveMemories('test query');
      
      // Then: Falls back gracefully
      expect(results).toBeDefined();
    });

    it('should cache query results', async () => {
      // Given: A query
      const query = 'test query';
      
      // When: Making same query twice
      const start1 = Date.now();
      const results1 = await intelligence.retrieveMemories(query);
      const time1 = Date.now() - start1;
      
      const start2 = Date.now();
      const results2 = await intelligence.retrieveMemories(query);
      const time2 = Date.now() - start2;
      
      // Then: Second query is faster (cached)
      expect(results2).toEqual(results1);
      expect(time2).toBeLessThan(time1 / 10);
    });
  });
});
```

### 4.2 Implement ContextBuilder

#### Implementation Requirements

```typescript
// src/intelligence/context-builder.ts
import { createLogger } from "../utils/logger.js";

const logger = createLogger("ContextBuilder");

export interface ContextBuilderConfig {
  maxSize: number;
  includeMetadata: boolean;
  deduplication: boolean;
  formatMarkdown?: boolean;
}

export interface ContextMemory {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export class ContextBuilder {
  private config: ContextBuilderConfig;

  constructor(config: ContextBuilderConfig) {
    this.config = {
      formatMarkdown: true,
      ...config
    };
  }

  async build(memories: ContextMemory[]): Promise<string> {
    if (memories.length === 0) {
      return "";
    }

    logger.debug(`Building context from ${memories.length} memories`);

    // 1. Deduplicate if enabled
    let processedMemories = memories;
    if (this.config.deduplication) {
      processedMemories = this.deduplicateMemories(memories);
    }

    // 2. Build context sections
    const sections: string[] = [];
    let currentSize = 0;
    const headerSize = this.config.formatMarkdown ? 50 : 0; // Rough estimate

    if (this.config.formatMarkdown) {
      sections.push("## Relevant Context\n");
      currentSize += headerSize;
    }

    // 3. Add memories until size limit
    for (const memory of processedMemories) {
      const section = this.formatMemory(memory);
      const sectionSize = section.length;

      if (currentSize + sectionSize > this.config.maxSize) {
        // Check if we can fit a truncated version
        const remainingSpace = this.config.maxSize - currentSize;
        if (remainingSpace > 100) {
          const truncated = this.truncateSection(section, remainingSpace);
          sections.push(truncated);
        }
        break;
      }

      sections.push(section);
      currentSize += sectionSize;
    }

    // 4. Join sections
    const context = sections.join("\n");
    logger.debug(`Built context of ${context.length} characters`);

    return context;
  }

  private deduplicateMemories(memories: ContextMemory[]): ContextMemory[] {
    const seen = new Map<string, ContextMemory>();
    const threshold = 0.85; // Similarity threshold

    for (const memory of memories) {
      const normalized = this.normalizeContent(memory.content);
      let isDuplicate = false;

      for (const [seenNormalized, seenMemory] of seen.entries()) {
        const similarity = this.calculateSimilarity(normalized, seenNormalized);
        if (similarity > threshold) {
          // Keep the one with higher score
          if (memory.score > seenMemory.score) {
            seen.set(normalized, memory);
          }
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        seen.set(normalized, memory);
      }
    }

    return Array.from(seen.values());
  }

  private formatMemory(memory: ContextMemory): string {
    const parts: string[] = [];

    if (this.config.formatMarkdown) {
      // Format based on event type
      const eventType = memory.metadata?.eventType as string;
      
      if (eventType === 'command_run') {
        parts.push(`### Command Execution`);
        if (this.config.includeMetadata && memory.metadata?.timestamp) {
          parts.push(`*${new Date(memory.metadata.timestamp).toISOString()}*`);
        }
        parts.push("```bash");
        parts.push(memory.content);
        parts.push("```");
        if (memory.metadata?.exitCode !== undefined) {
          parts.push(`Exit Code: ${memory.metadata.exitCode}`);
        }
      } else if (eventType === 'code_write' || eventType === 'file_write') {
        parts.push(`### Code Change`);
        if (this.config.includeMetadata && memory.metadata?.file) {
          parts.push(`File: \`${memory.metadata.file}\``);
          if (memory.metadata?.line) {
            parts.push(`Line: ${memory.metadata.line}`);
          }
        }
        const lang = this.detectLanguage(memory.metadata?.file as string || '');
        parts.push(`\`\`\`${lang}`);
        parts.push(memory.content);
        parts.push("```");
      } else {
        // Default format
        parts.push(`### Memory`);
        if (this.config.includeMetadata && memory.metadata?.timestamp) {
          parts.push(`*${new Date(memory.metadata.timestamp).toISOString()}*`);
        }
        parts.push(memory.content);
      }

      // Add metadata if enabled
      if (this.config.includeMetadata && Object.keys(memory.metadata || {}).length > 0) {
        const relevantMeta = this.filterRelevantMetadata(memory.metadata || {});
        if (Object.keys(relevantMeta).length > 0) {
          parts.push(`\n*Metadata: ${JSON.stringify(relevantMeta)}*`);
        }
      }

      // Add relevance score
      parts.push(`\n*Relevance: ${(memory.score * 100).toFixed(1)}%*`);
      parts.push("---");
    } else {
      // Plain text format
      parts.push(memory.content);
      if (this.config.includeMetadata) {
        parts.push(`[Score: ${memory.score.toFixed(2)}]`);
      }
    }

    return parts.join("\n") + "\n";
  }

  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  private calculateSimilarity(text1: string, text2: string): number {
    // Simple Jaccard similarity
    const words1 = new Set(text1.split(' '));
    const words2 = new Set(text2.split(' '));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  private truncateSection(section: string, maxLength: number): string {
    if (section.length <= maxLength) {
      return section;
    }

    const truncated = section.substring(0, maxLength - 20);
    return truncated + "\n... (truncated) ...\n";
  }

  private detectLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'jsx': 'javascript',
      'tsx': 'typescript',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'rb': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'r': 'r',
      'sql': 'sql',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'fish': 'bash',
      'ps1': 'powershell',
      'yml': 'yaml',
      'yaml': 'yaml',
      'json': 'json',
      'xml': 'xml',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'md': 'markdown',
      'markdown': 'markdown'
    };

    return langMap[ext || ''] || 'text';
  }

  private filterRelevantMetadata(metadata: Record<string, any>): Record<string, any> {
    const irrelevant = ['timestamp', 'id', 'embedding', 'vector'];
    const filtered: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (!irrelevant.includes(key) && value !== null && value !== undefined) {
        filtered[key] = value;
      }
    }

    return filtered;
  }
}
```

### 4.3 Update StorageEngine to Expose VectorStore

#### Implementation Requirements

```typescript
// src/storage/engine.ts - Add this method
export class StorageEngine {
  // ... existing code ...

  async getVectorStore(): Promise<VectorStore | null> {
    if (!this.initialized || !this.vectorStore) {
      return null;
    }
    return this.vectorStore;
  }

  // ... rest of code ...
}
```

## Phase 4.5: Intelligence Layer Integration (NEW)

### Overview
This new phase bridges the gap between individual components and creates a working system.

### 4.5.1 Integration Tests

#### Test Specifications

```typescript
// tests/integration/intelligence-integration.test.ts
describe('Intelligence Layer Integration', () => {
  let server: any;
  let storage: StorageEngine;
  let intelligence: IntelligenceLayer;
  let hooks: HookSystem;

  beforeEach(async () => {
    // Initialize all subsystems
    const testConfig = createTestConfig();
    
    storage = new StorageEngine(testConfig.storage);
    await storage.initialize();
    
    intelligence = new IntelligenceLayer(testConfig.intelligence, storage);
    await intelligence.initialize();
    
    hooks = new HookSystem(testConfig.hooks);
    await hooks.initialize();
  });

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
    expect(results[0].content).toContain('UserAuthenticationService');
    expect(results[0].score).toBeGreaterThan(0.7);

    // 3. Build context for injection
    const context = await intelligence.buildContext(results);
    
    expect(context).toContain('## Relevant Context');
    expect(context).toContain('### Code Change');
    expect(context).toContain('File: `src/services/auth.service.ts`');
    expect(context).toContain('UserAuthenticationService');
    expect(context.length).toBeLessThan(15000); // Within context size limit
  });

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
    expect(mainBranchResults[0].content).toBe('Main branch memory');
  });

  it('should maintain performance under load', async () => {
    // Create 100 memories
    const memories = [];
    for (let i = 0; i < 100; i++) {
      memories.push(
        storage.captureMemory({
          eventType: 'code_write',
          content: `Function ${i}: ${generateRandomCode()}`,
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
    expect(duration).toBeLessThan(200); // Must meet <200ms requirement
  });
});
```

### 4.5.2 Performance Optimizations

#### Implementation Requirements

```typescript
// src/intelligence/vector-index.ts - NEW FILE
export interface VectorIndex {
  add(id: string, vector: number[]): Promise<void>;
  search(query: number[], k: number): Promise<Array<{id: string; score: number}>>;
  remove(id: string): Promise<void>;
  size(): number;
}

// Simple in-memory index for now, upgrade to HNSW later
export class SimpleVectorIndex implements VectorIndex {
  private vectors: Map<string, number[]> = new Map();

  async add(id: string, vector: number[]): Promise<void> {
    this.vectors.set(id, vector);
  }

  async search(query: number[], k: number): Promise<Array<{id: string; score: number}>> {
    const results: Array<{id: string; score: number}> = [];
    
    for (const [id, vector] of this.vectors.entries()) {
      const score = this.cosineSimilarity(query, vector);
      results.push({ id, score });
    }
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async remove(id: string): Promise<void> {
    this.vectors.delete(id);
  }

  size(): number {
    return this.vectors.size;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

## Phase 5: MCP Server Integration

### Updated Requirements
Now that Phase 4 is properly implemented, Phase 5 can proceed as originally planned with one key update:

#### Update src/server/index.ts

```typescript
// Initialize subsystems with proper integration
async function initialize() {
  try {
    logger.info("Initializing Claude Memory MCP Server...");

    // Initialize storage engine first
    storage = new StorageEngine(config.storage);
    await storage.initialize();

    // Initialize intelligence layer with storage reference
    intelligence = new IntelligenceLayer(config.intelligence, storage);
    await intelligence.initialize();

    // Initialize other subsystems
    hooks = new HookSystem(config.hooks);
    await hooks.initialize();

    git = new GitIntegration(config.git);
    await git.initialize();

    // Register tools and resources
    registerTools();
    registerResources();

    logger.info("Server initialization complete");
  } catch (error) {
    logger.error("Failed to initialize server:", error);
    process.exit(1);
  }
}
```

## Updated Success Criteria

### Phase 4 Completion Criteria
- [ ] IntelligenceLayer.retrieveMemories() returns actual results
- [ ] ContextBuilder properly formats memories
- [ ] Vector search performs under 200ms for 10K vectors
- [ ] Integration tests pass for full memory lifecycle
- [ ] Fallback SQL search works when vectors unavailable
- [ ] Query caching reduces repeat query time by >90%

### Overall Project Criteria
- [ ] Semantic memory retrieval works end-to-end
- [ ] Performance requirements met (<200ms retrieval)
- [ ] All 254 tests passing
- [ ] Code coverage >80% for all modules
- [ ] Integration tested with Claude Code

## Conclusion

This updated plan addresses the critical gaps discovered during code review:

1. **Completes Intelligence Layer** with actual working implementation
2. **Adds Integration Phase** to connect components properly
3. **Implements ContextBuilder** for memory formatting
4. **Provides fallback** for when vector search unavailable
5. **Includes performance optimizations** from the start

The key insight is that Phase 4 needed to be split into two parts:
- Phase 4: Build individual components
- Phase 4.5: Integrate components into working system

This ensures the foundation is solid before proceeding to MCP integration and production hardening.

## Phase 6: Production Hardening (4 days)

### Overview
This phase addresses critical issues discovered during code review and prepares the system for production deployment by implementing robust error handling, security enhancements, and operational features.

### 6.1 Fix Critical Performance Issues

#### 6.1.1 Implement Scalable Vector Index (CRITICAL)
**Issue**: Current O(n) vector search won't scale beyond 10K vectors
**Priority**: Must fix before Phase 7

```typescript
// src/intelligence/vector-index.ts - Implement HNSW index
import { HNSWIndex } from 'hnswlib-node'; // or similar library

export class ScalableVectorIndex implements VectorIndex {
  private index: HNSWIndex;
  private idMapping: Map<number, string> = new Map();
  private reverseMapping: Map<string, number> = new Map();
  private nextId = 0;

  constructor(dimension: number, maxElements: number = 1000000) {
    this.index = new HNSWIndex('cosine', dimension);
    this.index.initIndex(maxElements);
  }

  async add(id: string, vector: number[]): Promise<void> {
    const internalId = this.nextId++;
    this.idMapping.set(internalId, id);
    this.reverseMapping.set(id, internalId);
    this.index.addPoint(vector, internalId);
  }

  async search(query: number[], k: number): Promise<Array<{id: string; score: number}>> {
    const results = this.index.searchKNN(query, k);
    return results.neighbors.map((internalId, idx) => ({
      id: this.idMapping.get(internalId) || '',
      score: 1 - results.distances[idx] // Convert distance to similarity
    }));
  }

  async remove(id: string): Promise<void> {
    const internalId = this.reverseMapping.get(id);
    if (internalId !== undefined) {
      // Note: HNSW doesn't support deletion, need to track deleted IDs
      this.idMapping.delete(internalId);
      this.reverseMapping.delete(id);
    }
  }

  size(): number {
    return this.reverseMapping.size;
  }

  // Persistence methods for production
  async save(path: string): Promise<void> {
    await this.index.writeIndex(path);
    // Also save ID mappings
  }

  async load(path: string): Promise<void> {
    await this.index.readIndex(path);
    // Also load ID mappings
  }
}
```

#### 6.1.2 Update VectorStore to Use Scalable Index

```typescript
// src/storage/vector-store.ts - Update to use ScalableVectorIndex
export class VectorStore {
  private index: ScalableVectorIndex;
  
  async initialize(): Promise<void> {
    // Replace SimpleVectorIndex with ScalableVectorIndex
    this.index = new ScalableVectorIndex(this.config.dimension);
    
    // Load persisted index if exists
    if (await this.indexExists()) {
      await this.index.load(this.getIndexPath());
    }
  }
}
```

### 6.2 Add Rate Limiting and Request Throttling

#### 6.2.1 Implement Rate Limiter
**Issue**: No request throttling could lead to resource exhaustion

```typescript
// src/utils/rate-limiter.ts
import { createLogger } from "./logger.js";

const logger = createLogger("RateLimiter");

export interface RateLimiterConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyGenerator?: (context: any) => string;
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private config: RateLimiterConfig;

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  async checkLimit(context: any = {}): Promise<{ allowed: boolean; retryAfter?: number }> {
    const key = this.config.keyGenerator ? this.config.keyGenerator(context) : 'default';
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Get request timestamps for this key
    let timestamps = this.requests.get(key) || [];
    
    // Remove old timestamps outside window
    timestamps = timestamps.filter(t => t > windowStart);
    
    if (timestamps.length >= this.config.maxRequests) {
      const oldestTimestamp = timestamps[0];
      const retryAfter = (oldestTimestamp + this.config.windowMs) - now;
      
      logger.warn(`Rate limit exceeded for key: ${key}`, {
        requests: timestamps.length,
        window: this.config.windowMs,
        retryAfter
      });
      
      return { allowed: false, retryAfter };
    }

    // Add current request
    timestamps.push(now);
    this.requests.set(key, timestamps);
    
    // Cleanup old keys periodically
    if (this.requests.size > 1000) {
      this.cleanup();
    }

    return { allowed: true };
  }

  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    for (const [key, timestamps] of this.requests.entries()) {
      const validTimestamps = timestamps.filter(t => t > windowStart);
      if (validTimestamps.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, validTimestamps);
      }
    }
  }
}
```

#### 6.2.2 Integrate Rate Limiting in Server

```typescript
// src/server/index.ts - Add rate limiting to tools
const memoryRateLimiter = new RateLimiter({
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 100,     // 100 requests per minute
  keyGenerator: (args) => args.sessionId || 'default'
});

// Wrap tool handlers with rate limiting
async function rateLimitedHandler(handler: Function, args: any) {
  const { allowed, retryAfter } = await memoryRateLimiter.checkLimit(args);
  
  if (!allowed) {
    return {
      content: [{
        type: "text" as const,
        text: `Rate limit exceeded. Please retry after ${Math.ceil(retryAfter / 1000)} seconds.`
      }],
      isError: true
    };
  }
  
  return handler(args);
}
```

### 6.3 Complete Missing Features

#### 6.3.1 Git Remote Tracking Implementation
**Issue**: Missing behind/ahead counts affects branch synchronization

```typescript
// src/git/monitor.ts - Add remote tracking
export class GitMonitor {
  async getRemoteTrackingInfo(): Promise<{ ahead: number; behind: number }> {
    try {
      // Get ahead count
      const ahead = await this.git.raw([
        'rev-list', 
        '--count', 
        '@{upstream}..HEAD'
      ]);
      
      // Get behind count  
      const behind = await this.git.raw([
        'rev-list',
        '--count', 
        'HEAD..@{upstream}'
      ]);
      
      return {
        ahead: parseInt(ahead.trim()) || 0,
        behind: parseInt(behind.trim()) || 0
      };
    } catch (error) {
      logger.debug('No remote tracking branch configured');
      return { ahead: 0, behind: 0 };
    }
  }
}
```

#### 6.3.2 Complete Vector Similarity Integration

```typescript
// src/storage/engine.ts - Complete TODO
async queryMemories(filters: QueryFilters = {}): Promise<Memory[]> {
  if (!this.initialized || !this.sqlite) {
    throw new Error("Storage engine not initialized");
  }

  logger.debug("Querying memories", filters);
  
  // If semantic query provided, use vector search
  if (filters.semanticQuery && this.vectorStore) {
    try {
      // Generate embedding for query
      const queryEmbedding = await this.embeddingService?.(filters.semanticQuery);
      
      if (queryEmbedding) {
        // Search vector store
        const vectorResults = await this.vectorStore.search(queryEmbedding, {
          k: filters.limit || 10,
          filter: {
            workspaceId: filters.workspaceId,
            sessionId: filters.sessionId,
            gitBranch: filters.gitBranch
          }
        });
        
        // Get full memories from SQLite
        const memoryIds = vectorResults.map(r => r.id);
        return this.sqlite.getMemoriesByIds(memoryIds);
      }
    } catch (error) {
      logger.warn("Vector search failed, falling back to SQL", error);
    }
  }
  
  // Fallback to SQL query
  return this.sqlite.queryMemories(filters);
}
```

### 6.4 Fix Code Quality Issues

#### 6.4.1 Fix Test Resource Cleanup

```typescript
// Add to all async close methods
async close(): Promise<void> {
  // Clear any timers
  if (this.cleanupTimer) {
    clearTimeout(this.cleanupTimer);
    this.cleanupTimer.unref(); // Prevent blocking process exit
  }
  
  // Rest of cleanup...
}
```

#### 6.4.2 Fix Error Messages and Remove Unused Code

```typescript
// src/intelligence/context-builder.ts:39
if (options.maxSize !== undefined && options.maxSize < 0) {
  throw new Error(`Invalid maxSize option: ${options.maxSize} (must be >= 0)`);
}

// src/storage/vector-store.ts - Remove lines 20-25
// Remove unused constants or implement them
```

### 6.5 Testing Requirements

```typescript
// tests/production/rate-limiter.test.ts
describe('RateLimiter', () => {
  it('should limit requests per window', async () => {
    const limiter = new RateLimiter({
      windowMs: 1000,
      maxRequests: 5
    });
    
    // Make 5 requests - all should pass
    for (let i = 0; i < 5; i++) {
      const result = await limiter.checkLimit();
      expect(result.allowed).toBe(true);
    }
    
    // 6th request should fail
    const result = await limiter.checkLimit();
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });
});

// tests/production/vector-index.test.ts
describe('ScalableVectorIndex', () => {
  it('should handle 100K vectors efficiently', async () => {
    const index = new ScalableVectorIndex(384);
    const vectors: number[][] = [];
    
    // Add 100K vectors
    for (let i = 0; i < 100000; i++) {
      const vector = generateRandomVector(384);
      vectors.push(vector);
      await index.add(`vec_${i}`, vector);
    }
    
    // Search should still be fast
    const start = Date.now();
    const results = await index.search(vectors[0], 10);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(50); // Much faster than O(n)
    expect(results[0].id).toBe('vec_0'); // Should find itself
  });
});
```

### Phase 6 Success Criteria
- [ ] Vector search scales to 100K+ vectors with <50ms latency
- [ ] Rate limiting prevents resource exhaustion
- [ ] Git remote tracking fully implemented
- [ ] Vector similarity integrated in StorageEngine
- [ ] All code quality issues resolved
- [ ] No test warnings about resource cleanup
- [ ] All tests pass with new features

## Phase 7: Performance Optimization (3 days)

### Overview
Focus on optimizing system performance, reducing latency, and improving resource efficiency.

### 7.1 Query Optimization

#### 7.1.1 Implement Query Planning
```typescript
// src/intelligence/query-planner.ts
export class QueryPlanner {
  async planQuery(query: string, options: QueryOptions): Promise<QueryPlan> {
    const plan: QueryPlan = {
      steps: [],
      estimatedCost: 0
    };
    
    // Analyze query complexity
    const hasSemanticSearch = !!query && query.length > 0;
    const hasFilters = Object.keys(options.filters || {}).length > 0;
    
    if (hasSemanticSearch && hasFilters) {
      // Hybrid search - filter first, then semantic
      plan.steps.push({
        type: 'filter',
        method: 'sql',
        filters: options.filters
      });
      plan.steps.push({
        type: 'semantic',
        method: 'vector',
        query: query
      });
    } else if (hasSemanticSearch) {
      // Pure semantic search
      plan.steps.push({
        type: 'semantic',
        method: 'vector',
        query: query
      });
    } else {
      // Pure filter search
      plan.steps.push({
        type: 'filter',
        method: 'sql',
        filters: options.filters
      });
    }
    
    return plan;
  }
}
```

#### 7.1.2 Implement Batch Processing
```typescript
// src/storage/batch-processor.ts
export class BatchProcessor {
  private queue: BatchItem[] = [];
  private processing = false;
  
  async addToQueue(item: BatchItem): Promise<void> {
    this.queue.push(item);
    
    if (!this.processing) {
      this.processBatch();
    }
  }
  
  private async processBatch(): Promise<void> {
    this.processing = true;
    
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, 100); // Process 100 at a time
      
      try {
        await this.processBatchItems(batch);
      } catch (error) {
        logger.error('Batch processing failed', error);
        // Re-queue failed items
        this.queue.unshift(...batch);
      }
    }
    
    this.processing = false;
  }
}
```

### 7.2 Caching Improvements

#### 7.2.1 Implement Multi-Level Cache
```typescript
// src/utils/multi-level-cache.ts
export class MultiLevelCache {
  private l1Cache: Map<string, CacheEntry> = new Map(); // In-memory
  private l2Cache?: RedisCache; // Optional Redis
  private l3Cache?: DiskCache; // Optional disk
  
  async get(key: string): Promise<any> {
    // Check L1
    const l1Result = this.l1Cache.get(key);
    if (l1Result && !this.isExpired(l1Result)) {
      return l1Result.value;
    }
    
    // Check L2
    if (this.l2Cache) {
      const l2Result = await this.l2Cache.get(key);
      if (l2Result) {
        this.l1Cache.set(key, l2Result); // Promote to L1
        return l2Result.value;
      }
    }
    
    // Check L3
    if (this.l3Cache) {
      const l3Result = await this.l3Cache.get(key);
      if (l3Result) {
        // Promote to L1 and L2
        this.l1Cache.set(key, l3Result);
        await this.l2Cache?.set(key, l3Result);
        return l3Result.value;
      }
    }
    
    return null;
  }
}
```

### 7.3 Resource Optimization

#### 7.3.1 Implement Connection Pooling
```typescript
// src/utils/connection-pool.ts
export class ConnectionPool {
  private pool: Database[] = [];
  private available: Database[] = [];
  private maxSize: number;
  
  constructor(config: PoolConfig) {
    this.maxSize = config.maxSize || 10;
  }
  
  async acquire(): Promise<Database> {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }
    
    if (this.pool.length < this.maxSize) {
      const conn = await this.createConnection();
      this.pool.push(conn);
      return conn;
    }
    
    // Wait for available connection
    return this.waitForConnection();
  }
  
  release(conn: Database): void {
    this.available.push(conn);
  }
}
```

### 7.4 Memory Management

#### 7.4.1 Implement Memory Pressure Handling
```typescript
// src/utils/memory-manager.ts
export class MemoryManager {
  private highWaterMark = 0.8; // 80% of heap
  private lowWaterMark = 0.6;  // 60% of heap
  
  startMonitoring(): void {
    setInterval(() => {
      const usage = process.memoryUsage();
      const heapUsed = usage.heapUsed / usage.heapTotal;
      
      if (heapUsed > this.highWaterMark) {
        this.handleHighMemoryPressure();
      }
    }, 5000).unref();
  }
  
  private handleHighMemoryPressure(): void {
    logger.warn('High memory pressure detected');
    
    // Clear caches
    global.gc?.(); // If --expose-gc flag is used
    
    // Emit event for other components
    this.emit('memory-pressure', { level: 'high' });
  }
}
```

### 7.5 Performance Testing

```typescript
// tests/performance/load-test.ts
describe('Performance Tests', () => {
  it('should handle 1000 concurrent requests', async () => {
    const requests = [];
    
    for (let i = 0; i < 1000; i++) {
      requests.push(
        intelligence.retrieveMemories(`query ${i}`, { limit: 5 })
      );
    }
    
    const start = Date.now();
    await Promise.all(requests);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(5000); // All within 5 seconds
  });
  
  it('should maintain <200ms p95 latency', async () => {
    const latencies: number[] = [];
    
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      await intelligence.retrieveMemories('test query');
      latencies.push(Date.now() - start);
    }
    
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    
    expect(p95).toBeLessThan(200);
  });
});
```

### Phase 7 Success Criteria
- [ ] P95 query latency < 200ms under normal load
- [ ] System handles 1000+ concurrent requests
- [ ] Memory usage remains stable under load
- [ ] Cache hit rate > 80% for repeated queries
- [ ] Batch processing reduces database load by 50%
- [ ] Connection pooling eliminates connection overhead

## Phase 8: Release Preparation (3 days)

### Overview
Prepare for production release with documentation, deployment scripts, monitoring, and operational tooling.

### 8.1 Documentation

#### 8.1.1 API Documentation
```typescript
// docs/api.md
# Claude Memory MCP API Reference

## Tools

### capture-memory
Captures a memory event for persistent storage.

**Input Schema:**
- `eventType` (string, required): Type of event being captured
- `content` (string, required): Memory content
- `metadata` (object, optional): Additional metadata

**Example:**
```json
{
  "eventType": "code_write",
  "content": "Implemented user authentication",
  "metadata": {
    "file": "auth.ts",
    "lines": 150
  }
}
```

### retrieve-memories
Retrieves relevant memories based on semantic search.

**Input Schema:**
- `query` (string, required): Semantic search query
- `limit` (number, optional): Maximum results (default: 10)
- `filters` (object, optional): Additional filters

**Rate Limits:**
- 100 requests per minute per session
- 1000 requests per hour per workspace
```

#### 8.1.2 Deployment Guide
```markdown
# Deployment Guide

## Prerequisites
- Node.js 18+
- SQLite3
- 2GB RAM minimum
- 10GB disk space

## Production Configuration

### Environment Variables
```bash
NODE_ENV=production
LOG_LEVEL=info
STORAGE_PATH=/var/lib/claude-memory
VECTOR_INDEX_PATH=/var/lib/claude-memory/vectors
MAX_MEMORY_SIZE=1GB
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### Systemd Service
```ini
[Unit]
Description=Claude Memory MCP Server
After=network.target

[Service]
Type=simple
User=claude-memory
WorkingDirectory=/opt/claude-memory
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```
```

### 8.2 Monitoring and Observability

#### 8.2.1 Prometheus Metrics
```typescript
// src/monitoring/metrics.ts
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export class MetricsCollector {
  private registry = new Registry();
  
  // Counters
  private memoryCaptures = new Counter({
    name: 'memory_captures_total',
    help: 'Total number of memory captures',
    labelNames: ['event_type', 'status']
  });
  
  // Histograms
  private queryLatency = new Histogram({
    name: 'query_latency_seconds',
    help: 'Query latency in seconds',
    labelNames: ['type'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
  });
  
  // Gauges
  private vectorIndexSize = new Gauge({
    name: 'vector_index_size',
    help: 'Number of vectors in index'
  });
  
  constructor() {
    this.registry.registerMetric(this.memoryCaptures);
    this.registry.registerMetric(this.queryLatency);
    this.registry.registerMetric(this.vectorIndexSize);
  }
  
  recordMemoryCapture(eventType: string, success: boolean): void {
    this.memoryCaptures.inc({
      event_type: eventType,
      status: success ? 'success' : 'failure'
    });
  }
  
  recordQueryLatency(type: string, duration: number): void {
    this.queryLatency.observe({ type }, duration / 1000);
  }
  
  updateVectorIndexSize(size: number): void {
    this.vectorIndexSize.set(size);
  }
  
  getMetrics(): string {
    return this.registry.metrics();
  }
}
```

#### 8.2.2 Health Check Endpoint
```typescript
// src/server/health.ts
export function registerHealthEndpoint(server: McpServer): void {
  server.registerTool(
    'health-detailed',
    {
      title: 'Detailed Health Check',
      description: 'Comprehensive health check with subsystem details'
    },
    async () => {
      const report = await healthChecker.checkHealth();
      
      // Add additional checks
      const extendedReport = {
        ...report,
        performance: {
          queryLatencyP95: metrics.getQueryLatencyP95(),
          cacheHitRate: cache.getHitRate(),
          vectorIndexSize: vectorStore.size()
        },
        resources: {
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage(),
          openConnections: connectionPool.getActiveCount()
        }
      };
      
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(extendedReport, null, 2)
        }]
      };
    }
  );
}
```

### 8.3 Security Hardening

#### 8.3.1 Input Validation Enhancement
```typescript
// src/utils/validator.ts
import { z } from 'zod';

export const MemoryInputSchema = z.object({
  eventType: z.string().min(1).max(50).regex(/^[a-z_]+$/),
  content: z.string().min(1).max(1_000_000), // 1MB max
  metadata: z.record(z.unknown()).optional().refine(
    (meta) => JSON.stringify(meta).length < 10_000,
    { message: "Metadata too large" }
  )
});

export const QueryInputSchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(100).optional(),
  filters: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});
```

#### 8.3.2 Secrets Management
```typescript
// src/utils/secrets.ts
export class SecretsManager {
  private secrets: Map<string, string> = new Map();
  
  async loadFromEnv(): Promise<void> {
    // Load from environment with validation
    const requiredSecrets = ['JWT_SECRET', 'ENCRYPTION_KEY'];
    
    for (const key of requiredSecrets) {
      const value = process.env[key];
      if (!value) {
        throw new Error(`Missing required secret: ${key}`);
      }
      this.secrets.set(key, value);
    }
  }
  
  get(key: string): string {
    const value = this.secrets.get(key);
    if (!value) {
      throw new Error(`Secret not found: ${key}`);
    }
    return value;
  }
}
```

### 8.4 Migration Scripts

#### 8.4.1 Data Migration
```typescript
// scripts/migrate-vector-index.ts
async function migrateToScalableIndex(): Promise<void> {
  console.log('Starting vector index migration...');
  
  // Load old index
  const oldStore = new VectorStore({ provider: 'local' });
  await oldStore.initialize();
  
  // Create new index
  const newIndex = new ScalableVectorIndex(384);
  
  // Migrate vectors in batches
  const batchSize = 1000;
  let offset = 0;
  
  while (true) {
    const vectors = await oldStore.getAllVectors(offset, batchSize);
    if (vectors.length === 0) break;
    
    for (const vector of vectors) {
      await newIndex.add(vector.id, vector.embedding);
    }
    
    offset += batchSize;
    console.log(`Migrated ${offset} vectors...`);
  }
  
  // Save new index
  await newIndex.save('./data/vector-index.hnsw');
  console.log('Migration complete!');
}
```

### 8.5 Release Checklist

```markdown
# Release Checklist

## Pre-Release
- [ ] All tests passing (100% of 400+ tests)
- [ ] Performance benchmarks meet requirements
- [ ] Security scan completed (no high/critical vulnerabilities)
- [ ] Documentation updated
- [ ] Migration scripts tested
- [ ] Backup procedures documented

## Release Process
- [ ] Tag release in git: `git tag -a v1.0.0 -m "Release 1.0.0"`
- [ ] Build production artifacts: `npm run build:prod`
- [ ] Run integration tests in staging
- [ ] Deploy to production with canary rollout
- [ ] Monitor metrics for 24 hours
- [ ] Update status page

## Post-Release
- [ ] Announce release to users
- [ ] Monitor error rates and performance
- [ ] Collect feedback
- [ ] Plan next iteration
```

### Phase 8 Success Criteria
- [ ] Complete API documentation with examples
- [ ] Deployment guide covers all production scenarios
- [ ] Monitoring exposes all key metrics
- [ ] Security hardening passes penetration testing
- [ ] Migration scripts handle all edge cases
- [ ] Release process is fully automated
- [ ] Zero critical issues in production for 48 hours