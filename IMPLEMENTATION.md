# Claude Code Memory MCP Server - Implementation Plan

## Table of Contents

1. [Overview](#overview)
2. [Implementation Phases](#implementation-phases)
3. [Phase 1: Storage Engine Foundation](#phase-1-storage-engine-foundation)
4. [Phase 2: Hook System Implementation](#phase-2-hook-system-implementation)
5. [Phase 3: Git Integration](#phase-3-git-integration)
6. [Phase 4: Intelligence Layer](#phase-4-intelligence-layer)
7. [Phase 5: MCP Server Integration](#phase-5-mcp-server-integration)
8. [Phase 6: Production Hardening](#phase-6-production-hardening)
9. [Phase 7: Performance Optimization](#phase-7-performance-optimization)
10. [Phase 8: Release Preparation](#phase-8-release-preparation)

## Overview

This document provides a complete, detailed implementation plan for the Claude Code Memory MCP Server. Each phase includes:
- Specific test specifications (TDD approach)
- Exact implementation requirements
- API contracts and data schemas
- Error handling specifications
- Performance requirements

### Development Principles

1. **Test-Driven Development (TDD)**: Write tests first, then implementation
2. **Defensive Programming**: Assume everything can fail
3. **Type Safety**: Leverage TypeScript's type system fully
4. **Incremental Progress**: Each step should be independently testable
5. **No Ambiguity**: Every requirement is explicitly defined

## Implementation Phases

### Phase Timeline
- Phase 1: Storage Engine Foundation (5 days)
- Phase 2: Hook System Implementation (4 days)
- Phase 3: Git Integration (3 days)
- Phase 4: Intelligence Layer (5 days)
- Phase 5: MCP Server Integration (3 days)
- Phase 6: Production Hardening (4 days)
- Phase 7: Performance Optimization (3 days)
- Phase 8: Release Preparation (3 days)

## Phase 1: Storage Engine Foundation

### 1.1 SQLite Database Layer

#### Test Specifications

```typescript
// tests/storage/sqlite.test.ts
describe('SQLiteDatabase', () => {
  describe('initialization', () => {
    it('should create database file at specified path', async () => {
      // Given: A database path
      const dbPath = '.test-memory/test.db';
      
      // When: Database is initialized
      const db = new SQLiteDatabase({ path: dbPath });
      await db.initialize();
      
      // Then: Database file exists
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('should enable WAL mode when configured', async () => {
      // Given: WAL mode enabled in config
      const db = new SQLiteDatabase({ path: ':memory:', walMode: true });
      
      // When: Database is initialized
      await db.initialize();
      
      // Then: WAL mode is active
      const result = await db.get('PRAGMA journal_mode');
      expect(result.journal_mode).toBe('wal');
    });

    it('should run all migrations in order', async () => {
      // Given: Migration files exist
      const db = new SQLiteDatabase({ path: ':memory:' });
      
      // When: Database is initialized
      await db.initialize();
      
      // Then: All tables exist with correct schema
      const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
      expect(tables).toContainEqual({ name: 'memories' });
      expect(tables).toContainEqual({ name: 'sessions' });
      expect(tables).toContainEqual({ name: 'git_states' });
    });
  });

  describe('memory operations', () => {
    it('should store memory with all fields', async () => {
      // Given: A memory object
      const memory = {
        eventType: 'file_write',
        content: 'Updated user.ts',
        metadata: { file: 'src/user.ts', lines: 42 },
        timestamp: new Date(),
        sessionId: 'session123',
        workspaceId: 'workspace456',
        gitBranch: 'main',
        gitCommit: 'abc123'
      };
      
      // When: Memory is stored
      const stored = await db.storeMemory(memory);
      
      // Then: Memory is retrievable with generated ID
      expect(stored.id).toMatch(/^mem_\d+_[a-z0-9]+$/);
      const retrieved = await db.getMemory(stored.id);
      expect(retrieved).toMatchObject(memory);
    });

    it('should handle transaction rollback on error', async () => {
      // Given: A transaction that will fail
      const memories = [
        { eventType: 'test', content: 'valid' },
        { eventType: null, content: 'invalid' } // Will fail NOT NULL constraint
      ];
      
      // When: Batch insert fails
      await expect(db.storeMemories(memories)).rejects.toThrow();
      
      // Then: No memories were stored
      const count = await db.count('memories');
      expect(count).toBe(0);
    });
  });
});
```

#### Implementation Requirements

```typescript
// src/storage/sqlite.ts
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';

export interface SQLiteConfig {
  path: string;
  walMode?: boolean;
  busyTimeout?: number;
  cacheSize?: number;
}

export class SQLiteDatabase {
  private db: Database.Database | null = null;
  private config: SQLiteConfig;

  constructor(config: SQLiteConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // 1. Create directory if needed
    if (this.config.path !== ':memory:') {
      await fs.mkdir(path.dirname(this.config.path), { recursive: true });
    }

    // 2. Open database connection
    this.db = new Database(this.config.path);

    // 3. Configure database
    if (this.config.walMode) {
      this.db.pragma('journal_mode = WAL');
    }
    if (this.config.busyTimeout) {
      this.db.pragma(`busy_timeout = ${this.config.busyTimeout}`);
    }
    if (this.config.cacheSize) {
      this.db.pragma(`cache_size = ${this.config.cacheSize}`);
    }

    // 4. Run migrations
    await this.runMigrations();
  }

  private async runMigrations(): Promise<void> {
    // Create migrations table
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Run each migration
    const migrations = await this.loadMigrations();
    for (const migration of migrations) {
      await this.runMigration(migration);
    }
  }
}
```

#### Database Schema

```sql
-- migrations/001_initial_schema.sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT, -- JSON
  timestamp DATETIME NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT,
  git_branch TEXT,
  git_commit TEXT,
  embedding_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_memories_session (session_id),
  INDEX idx_memories_workspace (workspace_id),
  INDEX idx_memories_timestamp (timestamp),
  INDEX idx_memories_event_type (event_type)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  workspace_id TEXT,
  metadata TEXT -- JSON
);

CREATE TABLE git_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  commit TEXT NOT NULL,
  is_dirty BOOLEAN NOT NULL,
  tracked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_git_states_workspace (workspace_id),
  INDEX idx_git_states_branch (branch)
);

CREATE TABLE vector_mappings (
  memory_id TEXT PRIMARY KEY,
  vector_id TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
```

### 1.2 Transaction Manager

#### Test Specifications

```typescript
// tests/storage/transactions.test.ts
describe('TransactionManager', () => {
  it('should execute successful transaction', async () => {
    // Given: A transaction function
    const result = await db.transaction(async (tx) => {
      await tx.run('INSERT INTO memories (id, content) VALUES (?, ?)', ['1', 'test']);
      return tx.get('SELECT * FROM memories WHERE id = ?', ['1']);
    });
    
    // Then: Transaction completes and returns result
    expect(result.content).toBe('test');
  });

  it('should rollback transaction on error', async () => {
    // Given: A failing transaction
    try {
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO memories (id, content) VALUES (?, ?)', ['2', 'test']);
        throw new Error('Simulated failure');
      });
    } catch (e) {
      // Expected
    }
    
    // Then: No data was committed
    const count = await db.get('SELECT COUNT(*) as count FROM memories');
    expect(count.count).toBe(0);
  });

  it('should handle nested transactions', async () => {
    // Given: Nested transaction calls
    await db.transaction(async (tx1) => {
      await tx1.run('INSERT INTO sessions (id) VALUES (?)', ['s1']);
      
      await db.transaction(async (tx2) => {
        await tx2.run('INSERT INTO memories (id, session_id) VALUES (?, ?)', ['m1', 's1']);
      });
    });
    
    // Then: Both operations complete
    expect(await db.exists('sessions', 's1')).toBe(true);
    expect(await db.exists('memories', 'm1')).toBe(true);
  });
});
```

### 1.3 Storage Engine Integration

#### Test Specifications

```typescript
// tests/storage/engine.test.ts
describe('StorageEngine', () => {
  describe('memory capture', () => {
    it('should validate memory size limits', async () => {
      // Given: A memory exceeding size limit
      const largeMemory = {
        eventType: 'file_write',
        content: 'x'.repeat(11 * 1024 * 1024), // 11MB
        metadata: {},
        timestamp: new Date(),
        sessionId: 'test'
      };
      
      // When: Attempting to store
      // Then: Should reject with size error
      await expect(storage.captureMemory(largeMemory))
        .rejects.toThrow('Memory size exceeds limit');
    });

    it('should generate embeddings for memory content', async () => {
      // Given: Mock embedding service
      const mockEmbedding = jest.fn().mockResolvedValue(new Array(384).fill(0.1));
      storage.setEmbeddingService(mockEmbedding);
      
      // When: Memory is captured
      const memory = await storage.captureMemory({
        eventType: 'code_write',
        content: 'function hello() { return "world"; }',
        sessionId: 'test'
      });
      
      // Then: Embedding was generated
      expect(mockEmbedding).toHaveBeenCalledWith('function hello() { return "world"; }');
      expect(memory.embeddingId).toBeDefined();
    });

    it('should enforce workspace isolation', async () => {
      // Given: Memories in different workspaces
      await storage.captureMemory({
        eventType: 'test',
        content: 'workspace1',
        workspaceId: 'ws1',
        sessionId: 's1'
      });
      
      await storage.captureMemory({
        eventType: 'test',
        content: 'workspace2',
        workspaceId: 'ws2',
        sessionId: 's2'
      });
      
      // When: Querying workspace 1
      const memories = await storage.queryMemories({ workspaceId: 'ws1' });
      
      // Then: Only workspace 1 memories returned
      expect(memories).toHaveLength(1);
      expect(memories[0].content).toBe('workspace1');
    });
  });

  describe('statistics', () => {
    it('should calculate accurate storage statistics', async () => {
      // Given: Various memories
      await storage.captureMemory({
        eventType: 'file_write',
        content: 'test1',
        metadata: { size: 100 },
        sessionId: 's1'
      });
      
      await storage.captureMemory({
        eventType: 'command_run',
        content: 'test2',
        metadata: { size: 200 },
        sessionId: 's1'
      });
      
      // When: Getting statistics
      const stats = await storage.getStatistics();
      
      // Then: Stats are accurate
      expect(stats).toEqual({
        totalMemories: 2,
        totalSize: 300,
        memoriesByType: {
          'file_write': 1,
          'command_run': 1
        },
        oldestMemory: expect.any(Date),
        newestMemory: expect.any(Date)
      });
    });
  });
});
```

#### Implementation Details

```typescript
// src/storage/engine.ts
export class StorageEngine {
  private sqlite: SQLiteDatabase;
  private vectorStore: VectorStore;
  private fileStore: FileStore;
  
  async captureMemory(memory: MemoryInput): Promise<Memory> {
    // 1. Validate memory
    this.validateMemory(memory);
    
    // 2. Check size limits
    const size = this.calculateMemorySize(memory);
    if (size > this.config.limits.maxFileSize) {
      throw new MemorySizeError(`Memory size ${size} exceeds limit`);
    }
    
    // 3. Begin transaction
    return await this.sqlite.transaction(async (tx) => {
      // 4. Generate ID
      const id = this.generateMemoryId();
      
      // 5. Store in SQLite
      const dbMemory = {
        id,
        event_type: memory.eventType,
        content: memory.content,
        metadata: JSON.stringify(memory.metadata || {}),
        timestamp: memory.timestamp.toISOString(),
        session_id: memory.sessionId,
        workspace_id: memory.workspaceId,
        git_branch: memory.gitBranch,
        git_commit: memory.gitCommit
      };
      
      await tx.run(
        `INSERT INTO memories (id, event_type, content, metadata, timestamp, 
         session_id, workspace_id, git_branch, git_commit) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        Object.values(dbMemory)
      );
      
      // 6. Generate and store embedding
      if (this.shouldGenerateEmbedding(memory)) {
        const embedding = await this.generateEmbedding(memory.content);
        const vectorId = await this.vectorStore.store(embedding, { memoryId: id });
        
        await tx.run(
          'INSERT INTO vector_mappings (memory_id, vector_id, model) VALUES (?, ?, ?)',
          [id, vectorId, this.config.intelligence.embeddings.model]
        );
      }
      
      // 7. Store large content in file system if needed
      if (size > 1024 * 10) { // 10KB threshold
        await this.fileStore.store(id, memory.content);
      }
      
      return { id, ...memory };
    });
  }

  private validateMemory(memory: MemoryInput): void {
    if (!memory.eventType) {
      throw new ValidationError('eventType is required');
    }
    if (!memory.content) {
      throw new ValidationError('content is required');
    }
    if (!memory.sessionId) {
      throw new ValidationError('sessionId is required');
    }
    if (memory.timestamp && !(memory.timestamp instanceof Date)) {
      throw new ValidationError('timestamp must be a Date object');
    }
  }
}
```

## Phase 2: Hook System Implementation

### 2.1 Hook Executor

#### Test Specifications

```typescript
// tests/hooks/executor.test.ts
describe('HookExecutor', () => {
  describe('command execution', () => {
    it('should execute allowed commands in sandbox', async () => {
      // Given: An allowed command
      const executor = new HookExecutor({
        sandbox: { allowedCommands: ['echo'] }
      });
      
      // When: Executing command
      const result = await executor.execute('echo "Hello World"');
      
      // Then: Command executes successfully
      expect(result.stdout).toBe('Hello World\n');
      expect(result.exitCode).toBe(0);
    });

    it('should reject disallowed commands', async () => {
      // Given: A disallowed command
      const executor = new HookExecutor({
        sandbox: { allowedCommands: ['echo'] }
      });
      
      // When: Attempting to execute
      // Then: Should reject
      await expect(executor.execute('rm -rf /'))
        .rejects.toThrow('Command not allowed: rm');
    });

    it('should enforce timeout', async () => {
      // Given: A long-running command
      const executor = new HookExecutor({
        execution: { timeout: 100 } // 100ms
      });
      
      // When: Command exceeds timeout
      // Then: Should timeout
      await expect(executor.execute('sleep 1'))
        .rejects.toThrow('Command timed out after 100ms');
    });

    it('should enforce memory limits', async () => {
      // Given: Memory limit configuration
      const executor = new HookExecutor({
        execution: { maxMemory: '1MB' }
      });
      
      // When: Command tries to allocate too much memory
      // Then: Should be killed
      await expect(executor.execute('node -e "Buffer.alloc(10000000)"'))
        .rejects.toThrow('Command exceeded memory limit');
    });
  });

  describe('environment isolation', () => {
    it('should provide only allowed environment variables', async () => {
      // Given: Specific env vars allowed
      const executor = new HookExecutor({
        sandbox: {
          env: { ALLOWED_VAR: 'value' }
        }
      });
      
      // When: Command checks environment
      const result = await executor.execute('echo $ALLOWED_VAR $SECRET_VAR');
      
      // Then: Only allowed vars are available
      expect(result.stdout).toBe('value \n');
    });

    it('should provide hook context variables', async () => {
      // Given: Hook context
      const context = {
        TOOL_NAME: 'Write',
        TOOL_INPUT_file_path: '/src/test.ts',
        SESSION_ID: 'session123'
      };
      
      // When: Executing with context
      const result = await executor.execute('echo $TOOL_NAME', { context });
      
      // Then: Context is available
      expect(result.stdout).toBe('Write\n');
    });
  });
});
```

### 2.2 Circuit Breaker

#### Test Specifications

```typescript
// tests/hooks/circuit-breaker.test.ts
describe('CircuitBreaker', () => {
  it('should open circuit after failure threshold', async () => {
    // Given: Circuit breaker with threshold of 3
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000
    });
    
    const failingOperation = jest.fn().mockRejectedValue(new Error('Failed'));
    
    // When: Operation fails 3 times
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute('test', failingOperation)).rejects.toThrow();
    }
    
    // Then: Circuit opens and rejects immediately
    await expect(cb.execute('test', failingOperation))
      .rejects.toThrow('Circuit breaker is open');
    expect(failingOperation).toHaveBeenCalledTimes(3); // Not called on 4th attempt
  });

  it('should enter half-open state after reset timeout', async () => {
    // Given: Open circuit
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeout: 100,
      halfOpenRequests: 1
    });
    
    await expect(cb.execute('test', () => Promise.reject())).rejects.toThrow();
    
    // When: Reset timeout passes
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Then: Circuit is half-open and allows one request
    const successOp = jest.fn().mockResolvedValue('success');
    expect(await cb.execute('test', successOp)).toBe('success');
    expect(cb.getState('test')).toBe('closed');
  });

  it('should track circuits per operation', async () => {
    // Given: Different operations
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    
    // When: One operation fails
    await expect(cb.execute('op1', () => Promise.reject())).rejects.toThrow();
    
    // Then: Other operations still work
    expect(await cb.execute('op2', () => Promise.resolve('ok'))).toBe('ok');
    expect(cb.getState('op1')).toBe('open');
    expect(cb.getState('op2')).toBe('closed');
  });
});
```

### 2.3 Hook System Integration

#### Test Specifications

```typescript
// tests/hooks/system.test.ts
describe('HookSystem', () => {
  describe('hook registration', () => {
    it('should match hooks by tool pattern', async () => {
      // Given: Hook configuration
      const system = new HookSystem({
        hooks: {
          PreToolUse: [{
            matcher: '^(Write|Edit)$',
            command: 'echo "File operation: $TOOL_NAME"'
          }]
        }
      });
      
      // When: Write tool is used
      const result = await system.executeHook({
        type: 'PreToolUse',
        tool: 'Write',
        data: { file_path: 'test.ts' }
      });
      
      // Then: Hook executes
      expect(result.output).toContain('File operation: Write');
    });

    it('should skip hooks that dont match', async () => {
      // Given: Hook with specific matcher
      const system = new HookSystem({
        hooks: {
          PreToolUse: [{
            matcher: '^Read$',
            command: 'echo "Reading"'
          }]
        }
      });
      
      // When: Different tool is used
      const result = await system.executeHook({
        type: 'PreToolUse',
        tool: 'Write',
        data: {}
      });
      
      // Then: No hook executes
      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should capture hook errors without blocking', async () => {
      // Given: Failing hook
      const system = new HookSystem({});
      system.registerHook('PostToolUse', {
        matcher: '.*',
        command: 'exit 1'
      });
      
      // When: Hook executes
      const result = await system.executeHook({
        type: 'PostToolUse',
        tool: 'Write'
      });
      
      // Then: Error is captured but not thrown
      expect(result.error).toBeDefined();
      expect(result.exitCode).toBe(1);
    });

    it('should respect circuit breaker for failing hooks', async () => {
      // Given: Hook that fails repeatedly
      const system = new HookSystem({
        circuitBreaker: { failureThreshold: 2 }
      });
      
      system.registerHook('PreToolUse', {
        matcher: '.*',
        command: 'exit 1',
        id: 'failing-hook'
      });
      
      // When: Hook fails twice
      await system.executeHook({ type: 'PreToolUse', tool: 'Test' });
      await system.executeHook({ type: 'PreToolUse', tool: 'Test' });
      
      // Then: Third execution is blocked
      const result = await system.executeHook({ type: 'PreToolUse', tool: 'Test' });
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('Circuit breaker open');
    });
  });
});
```

## Phase 3: Git Integration

### 3.1 Git State Monitor

#### Test Specifications

```typescript
// tests/git/monitor.test.ts
describe('GitMonitor', () => {
  describe('repository detection', () => {
    it('should detect git repository', async () => {
      // Given: A git repository
      await exec('git init');
      
      // When: Monitor initializes
      const monitor = new GitMonitor({ autoDetect: true });
      await monitor.initialize();
      
      // Then: Repository is detected
      expect(monitor.isGitRepository()).toBe(true);
      expect(monitor.getRepositoryRoot()).toBe(process.cwd());
    });

    it('should handle non-git directories', async () => {
      // Given: Not a git repository
      const monitor = new GitMonitor({ autoDetect: true });
      
      // When: Initializing in non-git directory
      await monitor.initialize();
      
      // Then: Gracefully handles absence
      expect(monitor.isGitRepository()).toBe(false);
      expect(monitor.getState()).toEqual({
        initialized: false,
        reason: 'Not a git repository'
      });
    });
  });

  describe('state tracking', () => {
    it('should track current branch', async () => {
      // Given: Repository on main branch
      await exec('git init && git checkout -b main');
      
      // When: Getting state
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const state = await monitor.getState();
      
      // Then: Branch is tracked
      expect(state.currentBranch).toBe('main');
    });

    it('should track dirty state', async () => {
      // Given: Repository with uncommitted changes
      await exec('git init');
      await fs.writeFile('test.txt', 'content');
      
      // When: Getting state
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const state = await monitor.getState();
      
      // Then: Dirty state is detected
      expect(state.isDirty).toBe(true);
      expect(state.changes).toContainEqual({
        file: 'test.txt',
        status: 'untracked'
      });
    });

    it('should detect branch switches', async () => {
      // Given: Monitor watching repository
      const monitor = new GitMonitor({});
      await monitor.initialize();
      const onChange = jest.fn();
      monitor.on('branchChange', onChange);
      
      // When: Branch changes
      await exec('git checkout -b feature');
      await monitor.checkForChanges();
      
      // Then: Change is detected
      expect(onChange).toHaveBeenCalledWith({
        from: 'main',
        to: 'feature'
      });
    });
  });
});
```

### 3.2 Memory Validation

#### Test Specifications

```typescript
// tests/git/validation.test.ts
describe('GitValidation', () => {
  it('should validate file existence in git', async () => {
    // Given: File tracked in git
    await exec('git init');
    await fs.writeFile('tracked.js', 'content');
    await exec('git add tracked.js && git commit -m "Add file"');
    
    // When: Validating memory
    const validator = new GitValidator();
    const result = await validator.validateMemory({
      id: 'mem1',
      eventType: 'file_write',
      metadata: { file: 'tracked.js' },
      gitCommit: 'HEAD'
    });
    
    // Then: Memory is valid
    expect(result.valid).toBe(true);
  });

  it('should detect file content mismatches', async () => {
    // Given: File content changed after memory
    await exec('git init');
    await fs.writeFile('file.js', 'original');
    await exec('git add file.js && git commit -m "Original"');
    const commit = await exec('git rev-parse HEAD');
    
    // Memory captured
    const memory = {
      id: 'mem1',
      eventType: 'file_read',
      content: 'original',
      metadata: { file: 'file.js' },
      gitCommit: commit.trim()
    };
    
    // File changed
    await fs.writeFile('file.js', 'modified');
    await exec('git add file.js && git commit -m "Modified"');
    
    // When: Validating old memory
    const validator = new GitValidator();
    const result = await validator.validateMemory(memory);
    
    // Then: Mismatch is detected
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('File content mismatch');
  });

  it('should validate branch availability', async () => {
    // Given: Memory from deleted branch
    const memory = {
      id: 'mem1',
      gitBranch: 'deleted-feature',
      gitCommit: 'abc123'
    };
    
    // When: Validating
    const validator = new GitValidator();
    const result = await validator.validateMemory(memory);
    
    // Then: Branch absence is detected
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Branch not found: deleted-feature');
  });
});
```

## Phase 4: Intelligence Layer

### 4.1 Embedding Generation

#### Test Specifications

```typescript
// tests/intelligence/embeddings.test.ts
describe('EmbeddingGenerator', () => {
  describe('model loading', () => {
    it('should load specified model', async () => {
      // Given: Model configuration
      const generator = new EmbeddingGenerator({
        model: 'all-MiniLM-L6-v2'
      });
      
      // When: Initializing
      await generator.initialize();
      
      // Then: Model is loaded
      expect(generator.getModelInfo()).toEqual({
        name: 'all-MiniLM-L6-v2',
        dimension: 384,
        ready: true
      });
    });

    it('should fallback to CPU if GPU unavailable', async () => {
      // Given: No GPU available
      jest.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      
      // When: Initializing
      const generator = new EmbeddingGenerator({});
      await generator.initialize();
      
      // Then: CPU backend is used
      expect(generator.getBackend()).toBe('cpu');
    });
  });

  describe('embedding generation', () => {
    it('should generate embeddings for text', async () => {
      // Given: Text input
      const generator = new EmbeddingGenerator({
        model: 'all-MiniLM-L6-v2'
      });
      await generator.initialize();
      
      // When: Generating embedding
      const embedding = await generator.generate('Hello world');
      
      // Then: Embedding has correct dimensions
      expect(embedding).toHaveLength(384);
      expect(embedding.every(x => typeof x === 'number')).toBe(true);
      expect(Math.abs(embedding.reduce((a, b) => a + b, 0))).toBeLessThan(0.1); // Roughly normalized
    });

    it('should batch process multiple texts', async () => {
      // Given: Multiple texts
      const texts = [
        'First document',
        'Second document',
        'Third document'
      ];
      
      // When: Batch processing
      const generator = new EmbeddingGenerator({ batchSize: 2 });
      await generator.initialize();
      const embeddings = await generator.generateBatch(texts);
      
      // Then: All embeddings generated
      expect(embeddings).toHaveLength(3);
      expect(embeddings[0]).toHaveLength(384);
    });

    it('should cache embeddings', async () => {
      // Given: Caching enabled
      const generator = new EmbeddingGenerator({ cache: true });
      await generator.initialize();
      
      // When: Generating same text twice
      const start1 = Date.now();
      const embedding1 = await generator.generate('Cached text');
      const time1 = Date.now() - start1;
      
      const start2 = Date.now();
      const embedding2 = await generator.generate('Cached text');
      const time2 = Date.now() - start2;
      
      // Then: Second call is faster (cached)
      expect(embedding1).toEqual(embedding2);
      expect(time2).toBeLessThan(time1 / 10); // At least 10x faster
    });
  });
});
```

### 4.2 Vector Storage

#### Test Specifications

```typescript
// tests/intelligence/vector-store.test.ts
describe('VectorStore', () => {
  describe('storage operations', () => {
    it('should store vectors with metadata', async () => {
      // Given: Vector and metadata
      const store = new VectorStore({ dimension: 384 });
      await store.initialize();
      
      const vector = new Array(384).fill(0.1);
      const metadata = { memoryId: 'mem123', type: 'code' };
      
      // When: Storing
      const id = await store.store(vector, metadata);
      
      // Then: Vector is retrievable
      const retrieved = await store.get(id);
      expect(retrieved.vector).toEqual(vector);
      expect(retrieved.metadata).toEqual(metadata);
    });

    it('should search by similarity', async () => {
      // Given: Multiple vectors
      const store = new VectorStore({ dimension: 384 });
      await store.initialize();
      
      // Store vectors
      await store.store(new Array(384).fill(0.1), { content: 'JavaScript function' });
      await store.store(new Array(384).fill(0.2), { content: 'Python function' });
      await store.store(new Array(384).fill(0.9), { content: 'Rust macro' });
      
      // When: Searching with query vector
      const queryVector = new Array(384).fill(0.15); // Close to JS
      const results = await store.search(queryVector, { k: 2 });
      
      // Then: Returns nearest neighbors
      expect(results).toHaveLength(2);
      expect(results[0].metadata.content).toBe('JavaScript function');
      expect(results[0].score).toBeGreaterThan(0.9);
    });

    it('should filter by metadata', async () => {
      // Given: Vectors with different types
      const store = new VectorStore({ dimension: 384 });
      await store.initialize();
      
      await store.store(new Array(384).fill(0.1), { type: 'code', lang: 'js' });
      await store.store(new Array(384).fill(0.2), { type: 'docs', lang: 'md' });
      await store.store(new Array(384).fill(0.3), { type: 'code', lang: 'py' });
      
      // When: Searching with filter
      const results = await store.search(new Array(384).fill(0.15), {
        k: 10,
        filter: { type: 'code' }
      });
      
      // Then: Only code vectors returned
      expect(results).toHaveLength(2);
      expect(results.every(r => r.metadata.type === 'code')).toBe(true);
    });
  });

  describe('persistence', () => {
    it('should persist vectors to disk', async () => {
      // Given: Vectors stored
      const store1 = new VectorStore({ 
        dimension: 384,
        path: '.test-vectors'
      });
      await store1.initialize();
      
      const id = await store1.store(new Array(384).fill(0.5), { test: true });
      await store1.close();
      
      // When: New instance loads
      const store2 = new VectorStore({ 
        dimension: 384,
        path: '.test-vectors'
      });
      await store2.initialize();
      
      // Then: Vectors are available
      const retrieved = await store2.get(id);
      expect(retrieved.metadata.test).toBe(true);
    });
  });
});
```

### 4.3 Context Builder

#### Test Specifications

```typescript
// tests/intelligence/context-builder.test.ts
describe('ContextBuilder', () => {
  describe('context construction', () => {
    it('should build context from memories', async () => {
      // Given: Retrieved memories
      const memories = [
        {
          id: 'mem1',
          content: 'Fixed user authentication bug',
          score: 0.95,
          metadata: { file: 'auth.ts', line: 42 },
          timestamp: new Date('2024-01-01')
        },
        {
          id: 'mem2',
          content: 'Added JWT token validation',
          score: 0.87,
          metadata: { file: 'auth.ts', line: 78 },
          timestamp: new Date('2024-01-02')
        }
      ];
      
      // When: Building context
      const builder = new ContextBuilder({ maxSize: 1000 });
      const context = await builder.build(memories);
      
      // Then: Context is formatted correctly
      expect(context).toContain('## Relevant Context');
      expect(context).toContain('Fixed user authentication bug');
      expect(context).toContain('auth.ts:42');
      expect(context).toContain('Score: 0.95');
    });

    it('should respect size limits', async () => {
      // Given: Many memories exceeding limit
      const memories = Array.from({ length: 100 }, (_, i) => ({
        id: `mem${i}`,
        content: 'x'.repeat(100),
        score: 0.9 - i * 0.001,
        timestamp: new Date()
      }));
      
      // When: Building with size limit
      const builder = new ContextBuilder({ maxSize: 500 });
      const context = await builder.build(memories);
      
      // Then: Context stays within limit
      expect(context.length).toBeLessThanOrEqual(500);
      expect(context).toContain('mem0'); // Highest score included
      expect(context).not.toContain('mem99'); // Low score excluded
    });

    it('should deduplicate similar content', async () => {
      // Given: Similar memories
      const memories = [
        {
          id: 'mem1',
          content: 'Fixed authentication bug in login',
          score: 0.95,
          timestamp: new Date()
        },
        {
          id: 'mem2',
          content: 'Fixed authentication bug in login function',
          score: 0.93,
          timestamp: new Date()
        }
      ];
      
      // When: Building with deduplication
      const builder = new ContextBuilder({ deduplication: true });
      const context = await builder.build(memories);
      
      // Then: Only one version included
      expect(context.match(/Fixed authentication bug/g)).toHaveLength(1);
      expect(context).toContain('mem1'); // Higher score kept
    });
  });

  describe('formatting', () => {
    it('should format based on event type', async () => {
      // Given: Different event types
      const memories = [
        {
          id: 'mem1',
          content: 'npm install express',
          score: 0.9,
          metadata: { eventType: 'command_run', exitCode: 0 },
          timestamp: new Date()
        },
        {
          id: 'mem2',
          content: 'function getData() { return db.query() }',
          score: 0.85,
          metadata: { eventType: 'code_write', file: 'data.js' },
          timestamp: new Date()
        }
      ];
      
      // When: Building context
      const builder = new ContextBuilder({});
      const context = await builder.build(memories);
      
      // Then: Each type formatted appropriately
      expect(context).toMatch(/```bash\s*npm install express\s*```/);
      expect(context).toMatch(/```javascript\s*function getData/);
    });
  });
});
```

## Phase 5: MCP Server Integration

### 5.1 Tool Implementation

#### Test Specifications

```typescript
// tests/server/tools.test.ts
describe('MCP Tools', () => {
  describe('capture-memory tool', () => {
    it('should capture memory through MCP', async () => {
      // Given: MCP client connected
      const client = await createTestClient();
      
      // When: Calling capture-memory tool
      const result = await client.callTool({
        name: 'capture-memory',
        arguments: {
          eventType: 'test_event',
          content: 'Test content',
          metadata: { custom: 'data' }
        }
      });
      
      // Then: Memory is captured
      expect(result.content[0].text).toMatch(/Memory captured: mem_\w+/);
      
      // Verify in database
      const memory = await storage.getLatestMemory();
      expect(memory.eventType).toBe('test_event');
      expect(memory.content).toBe('Test content');
    });

    it('should validate tool inputs', async () => {
      // Given: Invalid input
      const client = await createTestClient();
      
      // When: Missing required field
      const result = await client.callTool({
        name: 'capture-memory',
        arguments: {
          content: 'No event type'
        }
      });
      
      // Then: Error returned
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('eventType is required');
    });
  });

  describe('retrieve-memories tool', () => {
    it('should retrieve relevant memories', async () => {
      // Given: Memories in storage
      await storage.captureMemory({
        eventType: 'code_write',
        content: 'Authentication implementation',
        sessionId: 'test'
      });
      
      // When: Retrieving memories
      const client = await createTestClient();
      const result = await client.callTool({
        name: 'retrieve-memories',
        arguments: {
          query: 'authentication',
          limit: 5
        }
      });
      
      // Then: Relevant memories returned
      const memories = JSON.parse(result.content[0].text);
      expect(memories).toHaveLength(1);
      expect(memories[0].content).toContain('Authentication');
    });

    it('should apply filters', async () => {
      // Given: Memories with different types
      await storage.captureMemory({
        eventType: 'code_write',
        content: 'Code content',
        sessionId: 'test'
      });
      await storage.captureMemory({
        eventType: 'command_run',
        content: 'Command content',
        sessionId: 'test'
      });
      
      // When: Filtering by type
      const result = await client.callTool({
        name: 'retrieve-memories',
        arguments: {
          query: 'content',
          filters: { eventType: 'code_write' }
        }
      });
      
      // Then: Only code memories returned
      const memories = JSON.parse(result.content[0].text);
      expect(memories).toHaveLength(1);
      expect(memories[0].eventType).toBe('code_write');
    });
  });
});
```

### 5.2 Resource Implementation

#### Test Specifications

```typescript
// tests/server/resources.test.ts
describe('MCP Resources', () => {
  describe('memory-stats resource', () => {
    it('should provide current statistics', async () => {
      // Given: Memories in storage
      await storage.captureMemory({
        eventType: 'test1',
        content: 'x'.repeat(100),
        sessionId: 'test'
      });
      await storage.captureMemory({
        eventType: 'test2',
        content: 'x'.repeat(200),
        sessionId: 'test'
      });
      
      // When: Reading stats resource
      const client = await createTestClient();
      const resource = await client.readResource({
        uri: 'memory://stats'
      });
      
      // Then: Stats are accurate
      const stats = JSON.parse(resource.contents[0].text);
      expect(stats).toEqual({
        totalMemories: 2,
        totalSize: 300,
        memoriesByType: {
          test1: 1,
          test2: 1
        },
        oldestMemory: expect.any(String),
        newestMemory: expect.any(String)
      });
    });
  });

  describe('config resource', () => {
    it('should provide sanitized configuration', async () => {
      // Given: Server with sensitive config
      process.env.DATABASE_PASSWORD = 'secret123';
      
      // When: Reading config
      const client = await createTestClient();
      const resource = await client.readResource({
        uri: 'config://current'
      });
      
      // Then: Sensitive data is removed
      const config = JSON.parse(resource.contents[0].text);
      expect(config.storage.password).toBeUndefined();
      expect(config.git.credentials).toBeUndefined();
      expect(resource.contents[0].text).not.toContain('secret123');
    });
  });
});
```

### 5.3 Transport Configuration

#### Test Specifications

```typescript
// tests/server/transport.test.ts
describe('Server Transport', () => {
  it('should handle stdio transport', async () => {
    // Given: Server with stdio transport
    const server = new McpServer({ name: 'test', version: '1.0' });
    const transport = new StdioServerTransport();
    
    // When: Connecting
    await server.connect(transport);
    
    // Then: Server responds to requests
    const response = await sendStdioRequest({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1
    });
    
    expect(response.result.tools).toContainEqual(
      expect.objectContaining({ name: 'capture-memory' })
    );
  });

  it('should handle connection errors gracefully', async () => {
    // Given: Transport that fails
    const server = new McpServer({ name: 'test', version: '1.0' });
    const transport = new FailingTransport();
    
    // When: Connection fails
    const error = await server.connect(transport).catch(e => e);
    
    // Then: Error is handled
    expect(error.message).toContain('Transport connection failed');
    expect(server.isConnected()).toBe(false);
  });
});
```

## Phase 6: Production Hardening

### 6.1 Error Recovery

#### Test Specifications

```typescript
// tests/reliability/recovery.test.ts
describe('Error Recovery', () => {
  describe('database recovery', () => {
    it('should recover from corrupted database', async () => {
      // Given: Corrupted database file
      await fs.writeFile('.claude-memory/memory.db', 'corrupted data');
      
      // When: Storage initializes
      const storage = new StorageEngine(config);
      await storage.initialize();
      
      // Then: Database is recreated
      expect(await storage.getStatistics()).toEqual({
        totalMemories: 0,
        totalSize: 0,
        memoriesByType: {}
      });
      
      // And: Backup was created
      expect(fs.existsSync('.claude-memory/memory.db.corrupt.backup')).toBe(true);
    });

    it('should recover from transaction deadlock', async () => {
      // Given: Concurrent transactions causing deadlock
      const storage = new StorageEngine(config);
      await storage.initialize();
      
      // When: Deadlock occurs
      const promises = Array.from({ length: 10 }, (_, i) =>
        storage.captureMemory({
          eventType: 'concurrent',
          content: `Memory ${i}`,
          sessionId: 'test'
        })
      );
      
      // Then: All complete successfully with retries
      const results = await Promise.allSettled(promises);
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    });
  });

  describe('vector store recovery', () => {
    it('should rebuild vector index on corruption', async () => {
      // Given: Corrupted vector index
      const vectorStore = new VectorStore({ path: '.vectors' });
      await vectorStore.initialize();
      await vectorStore.store([0.1, 0.2], { id: 'test' });
      
      // Corrupt index
      await fs.writeFile('.vectors/index.bin', 'corrupted');
      
      // When: Reopening
      await vectorStore.close();
      await vectorStore.initialize();
      
      // Then: Index is rebuilt from data
      const results = await vectorStore.search([0.1, 0.2], { k: 1 });
      expect(results[0].metadata.id).toBe('test');
    });
  });
});
```

### 6.2 Monitoring and Metrics

#### Test Specifications

```typescript
// tests/monitoring/metrics.test.ts
describe('Metrics Collection', () => {
  it('should track operation latencies', async () => {
    // Given: Metrics collector
    const metrics = new MetricsCollector();
    const storage = new StorageEngine(config);
    storage.setMetricsCollector(metrics);
    
    // When: Operations execute
    await storage.captureMemory({
      eventType: 'test',
      content: 'content',
      sessionId: 'test'
    });
    
    // Then: Latencies are recorded
    const stats = metrics.getStats('storage.capture_memory');
    expect(stats.count).toBe(1);
    expect(stats.p50).toBeGreaterThan(0);
    expect(stats.p99).toBeGreaterThan(stats.p50);
  });

  it('should track error rates', async () => {
    // Given: Operation that fails
    const metrics = new MetricsCollector();
    const storage = new StorageEngine(config);
    storage.setMetricsCollector(metrics);
    
    // When: Error occurs
    await storage.captureMemory({
      eventType: null as any, // Invalid
      content: 'test',
      sessionId: 'test'
    }).catch(() => {});
    
    // Then: Error is tracked
    const errorRate = metrics.getErrorRate('storage.capture_memory');
    expect(errorRate).toBe(1.0); // 100% error rate
  });

  it('should export OpenTelemetry metrics', async () => {
    // Given: OpenTelemetry exporter
    const exporter = new PrometheusExporter({ port: 9090 });
    const metrics = new MetricsCollector({ exporter });
    
    // When: Metrics are collected
    metrics.recordLatency('test.operation', 100);
    metrics.recordCounter('test.count', 1);
    
    // Then: Metrics are available at endpoint
    const response = await fetch('http://localhost:9090/metrics');
    const text = await response.text();
    expect(text).toContain('test_operation_duration_milliseconds');
    expect(text).toContain('test_count_total 1');
  });
});
```

### 6.3 Data Integrity Checks

#### Test Specifications

```typescript
// tests/integrity/validation.test.ts
describe('Data Integrity', () => {
  describe('checksum validation', () => {
    it('should detect corrupted memories', async () => {
      // Given: Memory with checksum
      const storage = new StorageEngine(config);
      await storage.initialize();
      
      const memory = await storage.captureMemory({
        eventType: 'test',
        content: 'Original content',
        sessionId: 'test'
      });
      
      // When: Content is corrupted directly in DB
      await storage.getDatabase().run(
        'UPDATE memories SET content = ? WHERE id = ?',
        ['Corrupted content', memory.id]
      );
      
      // Then: Corruption is detected
      const validation = await storage.validateIntegrity();
      expect(validation.corrupted).toContainEqual({
        id: memory.id,
        issue: 'Checksum mismatch'
      });
    });

    it('should quarantine corrupted data', async () => {
      // Given: Corrupted memory detected
      const storage = new StorageEngine(config);
      await storage.initialize();
      
      // When: Running integrity check with auto-fix
      const result = await storage.validateIntegrity({ autoFix: true });
      
      // Then: Corrupted memories are quarantined
      expect(result.quarantined).toHaveLength(1);
      expect(await storage.getMemory(result.quarantined[0])).toBeNull();
      
      // And: Quarantine table has entry
      const quarantined = await storage.getQuarantined();
      expect(quarantined[0].reason).toBe('Checksum mismatch');
    });
  });

  describe('referential integrity', () => {
    it('should detect orphaned vector mappings', async () => {
      // Given: Vector mapping without memory
      await db.run(
        'INSERT INTO vector_mappings (memory_id, vector_id, model) VALUES (?, ?, ?)',
        ['non_existent', 'vec123', 'model']
      );
      
      // When: Checking integrity
      const validation = await storage.validateIntegrity();
      
      // Then: Orphan is detected
      expect(validation.orphaned).toContainEqual({
        table: 'vector_mappings',
        id: 'non_existent',
        issue: 'References non-existent memory'
      });
    });
  });
});
```

## Phase 7: Performance Optimization

### 7.1 Caching Layer

#### Test Specifications

```typescript
// tests/performance/cache.test.ts
describe('Cache Performance', () => {
  it('should cache frequent queries', async () => {
    // Given: Cache-enabled storage
    const storage = new StorageEngine({
      ...config,
      performance: { cache: { enabled: true, ttl: 1000 } }
    });
    
    // When: Same query executed multiple times
    const times = [];
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      await storage.queryMemories({ 
        workspace: 'test',
        eventType: 'code_write' 
      });
      times.push(Date.now() - start);
    }
    
    // Then: Subsequent queries are faster
    expect(times[1]).toBeLessThan(times[0] / 10);
    expect(times[2]).toBeLessThan(times[0] / 10);
  });

  it('should invalidate cache on updates', async () => {
    // Given: Cached query
    const result1 = await storage.queryMemories({ eventType: 'test' });
    
    // When: New memory added
    await storage.captureMemory({
      eventType: 'test',
      content: 'New content',
      sessionId: 'test'
    });
    
    // Then: Next query returns fresh data
    const result2 = await storage.queryMemories({ eventType: 'test' });
    expect(result2.length).toBe(result1.length + 1);
  });

  it('should limit cache size', async () => {
    // Given: Cache with size limit
    const cache = new LRUCache({ 
      maxSize: '1MB',
      ttl: 60000 
    });
    
    // When: Adding items exceeding limit
    for (let i = 0; i < 1000; i++) {
      cache.set(`key${i}`, 'x'.repeat(10000)); // 10KB each
    }
    
    // Then: Cache stays within limit
    expect(cache.getSize()).toBeLessThanOrEqual(1024 * 1024);
    expect(cache.has('key0')).toBe(false); // Evicted
    expect(cache.has('key999')).toBe(true); // Recent
  });
});
```

### 7.2 Query Optimization

#### Test Specifications

```typescript
// tests/performance/queries.test.ts
describe('Query Performance', () => {
  it('should use indexes efficiently', async () => {
    // Given: Large dataset
    for (let i = 0; i < 10000; i++) {
      await storage.captureMemory({
        eventType: i % 2 === 0 ? 'type_a' : 'type_b',
        content: `Memory ${i}`,
        sessionId: `session${i % 100}`,
        timestamp: new Date(Date.now() - i * 1000)
      });
    }
    
    // When: Complex query
    const start = Date.now();
    const results = await storage.queryMemories({
      eventType: 'type_a',
      sessionId: 'session42',
      startTime: new Date(Date.now() - 86400000),
      limit: 10
    });
    const queryTime = Date.now() - start;
    
    // Then: Query is fast due to indexes
    expect(queryTime).toBeLessThan(50); // 50ms max
    expect(results).toHaveLength(10);
    
    // Verify query plan uses indexes
    const plan = await storage.explainQuery({
      eventType: 'type_a',
      sessionId: 'session42'
    });
    expect(plan).toContain('USING INDEX idx_memories_event_type');
    expect(plan).toContain('USING INDEX idx_memories_session');
  });

  it('should optimize vector searches', async () => {
    // Given: Many vectors
    const vectorStore = new VectorStore({ dimension: 384 });
    for (let i = 0; i < 10000; i++) {
      const vector = Array(384).fill(0).map(() => Math.random());
      await vectorStore.store(vector, { id: i });
    }
    
    // When: Searching with filters
    const start = Date.now();
    const results = await vectorStore.search(Array(384).fill(0.5), {
      k: 10,
      filter: { id: { $gte: 5000 } } // Only search half
    });
    const searchTime = Date.now() - start;
    
    // Then: Search is optimized
    expect(searchTime).toBeLessThan(100); // 100ms max
    expect(results.every(r => r.metadata.id >= 5000)).toBe(true);
  });
});
```

### 7.3 Background Tasks

#### Test Specifications

```typescript
// tests/performance/background.test.ts
describe('Background Tasks', () => {
  it('should clean up old memories periodically', async () => {
    // Given: Old memories
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days
    for (let i = 0; i < 100; i++) {
      await storage.captureMemory({
        eventType: 'old',
        content: 'Old memory',
        timestamp: oldDate,
        sessionId: 'old'
      });
    }
    
    // When: Cleanup task runs
    const cleaner = new MemoryCleaner(storage, {
      maxAge: 60 * 24 * 60 * 60 * 1000, // 60 days
      runInterval: 100 // Run immediately for test
    });
    await cleaner.start();
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Then: Old memories are removed
    const remaining = await storage.queryMemories({ eventType: 'old' });
    expect(remaining).toHaveLength(0);
  });

  it('should optimize database periodically', async () => {
    // Given: Fragmented database
    // Add and delete many records
    for (let i = 0; i < 1000; i++) {
      const mem = await storage.captureMemory({
        eventType: 'temp',
        content: 'x'.repeat(1000),
        sessionId: 'test'
      });
      if (i % 2 === 0) {
        await storage.deleteMemory(mem.id);
      }
    }
    
    // When: Optimization runs
    const optimizer = new DatabaseOptimizer(storage);
    const before = await storage.getDatabaseSize();
    await optimizer.optimize();
    const after = await storage.getDatabaseSize();
    
    // Then: Database is compacted
    expect(after).toBeLessThan(before * 0.7); // At least 30% reduction
  });
});
```

## Phase 8: Release Preparation

### 8.1 End-to-End Tests

#### Test Specifications

```typescript
// tests/e2e/full-workflow.test.ts
describe('End-to-End Workflows', () => {
  it('should handle complete memory lifecycle', async () => {
    // Given: Fresh server instance
    const server = await startServer();
    const client = await connectClient();
    
    // When: Complete workflow
    // 1. Capture memory from hook
    const hookResult = await simulateHook({
      type: 'PostToolUse',
      tool: 'Write',
      data: {
        file_path: 'src/test.ts',
        content: 'export function test() { return true; }'
      }
    });
    expect(hookResult.success).toBe(true);
    
    // 2. Retrieve via MCP
    const memories = await client.callTool({
      name: 'retrieve-memories',
      arguments: { query: 'test.ts' }
    });
    expect(JSON.parse(memories.content[0].text)).toHaveLength(1);
    
    // 3. Git branch switch
    await exec('git checkout -b feature');
    await waitForGitSync();
    
    // 4. Verify branch isolation
    const mainMemories = await client.callTool({
      name: 'retrieve-memories',
      arguments: { 
        query: 'test.ts',
        filters: { gitBranch: 'main' }
      }
    });
    expect(JSON.parse(mainMemories.content[0].text)).toHaveLength(0);
    
    // 5. Server restart
    await server.stop();
    const server2 = await startServer();
    
    // 6. Verify persistence
    const afterRestart = await client.callTool({
      name: 'retrieve-memories',
      arguments: { query: 'test.ts' }
    });
    expect(JSON.parse(afterRestart.content[0].text)).toHaveLength(1);
  });

  it('should handle high load', async () => {
    // Given: Server under load
    const server = await startServer();
    const clients = await Promise.all(
      Array.from({ length: 10 }, () => connectClient())
    );
    
    // When: Concurrent operations
    const operations = [];
    for (let i = 0; i < 100; i++) {
      const client = clients[i % 10];
      operations.push(
        client.callTool({
          name: 'capture-memory',
          arguments: {
            eventType: 'load_test',
            content: `Operation ${i}`,
            metadata: { index: i }
          }
        })
      );
    }
    
    const results = await Promise.allSettled(operations);
    
    // Then: All operations complete
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(100);
    
    // Verify data consistency
    const allMemories = await clients[0].callTool({
      name: 'retrieve-memories',
      arguments: { 
        query: 'load_test',
        limit: 200
      }
    });
    expect(JSON.parse(allMemories.content[0].text)).toHaveLength(100);
  });
});
```

### 8.2 Integration Tests

#### Test Specifications

```typescript
// tests/integration/claude-code.test.ts
describe('Claude Code Integration', () => {
  it('should work with Claude Code hooks', async () => {
    // Given: Hook configuration
    const hookConfig = {
      PreToolUse: [{
        matcher: '^Write$',
        hooks: [{
          type: 'command',
          command: 'claude-memory inject --tool=$TOOL_NAME --file=$TOOL_INPUT_file_path'
        }]
      }]
    };
    
    // When: Claude Code executes Write tool
    const claudeResult = await simulateClaudeTool({
      tool: 'Write',
      input: {
        file_path: 'src/app.ts',
        content: 'const app = express();'
      },
      hooks: hookConfig
    });
    
    // Then: Memory is captured and context injected
    expect(claudeResult.hookOutput).toContain('Context injected');
    
    const memory = await storage.getLatestMemory();
    expect(memory.eventType).toBe('PreToolUse');
    expect(memory.metadata.tool).toBe('Write');
  });

  it('should handle MCP connection lifecycle', async () => {
    // Given: Claude Code configuration
    const config = {
      'claude-memory': {
        command: 'node',
        args: ['dist/server/index.js'],
        env: { LOG_LEVEL: 'debug' }
      }
    };
    
    // When: Claude Code starts
    const claude = await startClaudeWithConfig(config);
    
    // Then: MCP server is available
    const servers = await claude.listServers();
    expect(servers).toContainEqual({
      name: 'claude-memory',
      status: 'connected'
    });
    
    // When: Claude Code stops
    await claude.stop();
    
    // Then: Server shuts down gracefully
    const logs = await readServerLogs();
    expect(logs).toContain('Shutting down server...');
    expect(logs).toContain('Storage engine closed');
  });
});
```

### 8.3 Documentation Tests

#### Test Specifications

```typescript
// tests/docs/examples.test.ts
describe('Documentation Examples', () => {
  it('should run all README examples', async () => {
    // Given: Examples from README
    const examples = extractCodeBlocks('README.md');
    
    // When/Then: Each example runs successfully
    for (const example of examples) {
      if (example.language === 'typescript') {
        const result = await runTypeScriptExample(example.code);
        expect(result.success).toBe(true);
      } else if (example.language === 'bash') {
        const result = await runBashExample(example.code);
        expect(result.exitCode).toBe(0);
      }
    }
  });

  it('should validate configuration examples', async () => {
    // Given: Config examples
    const configs = [
      'examples/claude-config.json',
      'examples/hooks-config.json'
    ];
    
    // When/Then: Each config is valid
    for (const configPath of configs) {
      const config = await fs.readJson(configPath);
      const validation = validateConfig(config);
      expect(validation.valid).toBe(true);
    }
  });
});
```

## Implementation Order and Dependencies

### Dependency Graph
```
Phase 1: Storage Engine
  ├─> Phase 2: Hook System
  ├─> Phase 3: Git Integration  
  └─> Phase 4: Intelligence Layer
      └─> Phase 5: MCP Integration
          └─> Phase 6: Production Hardening
              └─> Phase 7: Performance
                  └─> Phase 8: Release
```

### Critical Path
1. **Storage Engine** - Foundation for all data operations
2. **Intelligence Layer** - Required for memory retrieval
3. **MCP Integration** - Core functionality exposure
4. **Hook System** - Event capture mechanism
5. **Production Hardening** - Required for reliability

### Parallel Development Opportunities
- **Hook System** and **Git Integration** can be developed in parallel after Storage Engine
- **Performance Optimization** can begin during Phase 6
- **Documentation** and **Examples** can be created throughout

## Success Criteria

### Functional Requirements
- [ ] All PRD requirements implemented
- [ ] All tests passing (100% of test suite)
- [ ] Code coverage > 90%
- [ ] No critical security vulnerabilities

### Performance Requirements
- [ ] Hook execution < 500ms (p95)
- [ ] Memory storage < 100ms (p95)
- [ ] Query response < 200ms (p95)
- [ ] Context injection < 200ms (p95)

### Reliability Requirements
- [ ] 99.9% uptime during development sessions
- [ ] Zero data loss guarantee
- [ ] Automatic recovery from failures
- [ ] Graceful degradation

### Quality Requirements
- [ ] TypeScript strict mode compliance
- [ ] ESLint zero errors/warnings
- [ ] Complete API documentation
- [ ] Comprehensive error messages

## Conclusion

This implementation plan provides complete, unambiguous specifications for building the Claude Code Memory MCP Server. Each component has:

1. **Detailed test specifications** written in TDD style
2. **Exact implementation requirements** with no ambiguity
3. **Clear API contracts** and data schemas
4. **Specific error handling** requirements
5. **Measurable performance** targets

Following this plan, a coding agent can implement each phase without guessing or making assumptions. The test-first approach ensures correctness, and the detailed specifications eliminate ambiguity.