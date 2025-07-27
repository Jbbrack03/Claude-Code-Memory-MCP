# Claude Code Memory MCP Server - Updated Implementation Plan

## Table of Contents

1. [Overview](#overview)
2. [Critical Issues Identified](#critical-issues-identified)
3. [Updated Implementation Phases](#updated-implementation-phases)
4. [Phase 1: Storage Engine Foundation](#phase-1-storage-engine-foundation) ✅
5. [Phase 2: Hook System Implementation](#phase-2-hook-system-implementation) ✅
6. [Phase 3: Git Integration](#phase-3-git-integration) ✅
7. [Phase 4: Intelligence Layer Core Components](#phase-4-intelligence-layer-core-components) 🚧
8. [Phase 4.5: Intelligence Layer Integration](#phase-45-intelligence-layer-integration) 🆕
9. [Phase 5: MCP Server Integration](#phase-5-mcp-server-integration)
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
- **Phase 4: Intelligence Layer Core Components (5 days)** 🚧 In Progress
- **Phase 4.5: Intelligence Layer Integration (3 days)** 🆕 NEW
- Phase 5: MCP Server Integration (3 days)
- Phase 6: Production Hardening (4 days)
- Phase 7: Performance Optimization (3 days)
- Phase 8: Release Preparation (3 days)

## Phase 4: Intelligence Layer Core Components

### Current Status
- ✅ EmbeddingGenerator: Complete with 97% coverage
- ✅ VectorStore: Implemented but over-engineered
- ❌ ContextBuilder: Not implemented
- ❌ IntelligenceLayer: Only stub implementation

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