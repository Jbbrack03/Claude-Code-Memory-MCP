import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SQLiteDatabase');

export interface SQLiteConfig {
  path: string;
  walMode?: boolean;
  busyTimeout?: number;
  cacheSize?: number;
}

export interface Memory {
  id?: string;
  eventType: string;
  content: string;
  metadata?: Record<string, any>;
  timestamp: Date;
  sessionId: string;
  workspaceId?: string;
  gitBranch?: string;
  gitCommit?: string;
}

export class SQLiteDatabase {
  private db: Database.Database | null = null;
  private config: SQLiteConfig;

  constructor(config: SQLiteConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    logger.info('Initializing SQLite database...');
    
    // 1. Create directory if needed
    if (this.config.path !== ':memory:') {
      const dir = path.dirname(this.config.path);
      await fs.mkdir(dir, { recursive: true });
    }

    // 2. Open database connection
    this.db = new Database(this.config.path);
    logger.debug(`Database opened at ${this.config.path}`);

    // 3. Configure database
    if (this.config.walMode) {
      this.db.pragma('journal_mode = WAL');
      logger.debug('WAL mode enabled');
    }
    if (this.config.busyTimeout) {
      this.db.pragma(`busy_timeout = ${this.config.busyTimeout}`);
    }
    if (this.config.cacheSize) {
      this.db.pragma(`cache_size = ${this.config.cacheSize}`);
    }

    // 4. Run migrations
    await this.runMigrations();
    
    logger.info('SQLite database initialized');
  }

  private async runMigrations(): Promise<void> {
    logger.debug('Running database migrations...');
    
    // Create migrations table
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Define migrations
    const migrations = [
      {
        name: '001_initial_schema',
        sql: `
          CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT,
            timestamp DATETIME NOT NULL,
            session_id TEXT NOT NULL,
            workspace_id TEXT,
            git_branch TEXT,
            git_commit TEXT,
            embedding_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );`
      },
      {
        name: '002_memory_indexes',
        sql: `CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`
      },
      {
        name: '002a_memory_indexes_workspace',
        sql: `CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_id)`
      },
      {
        name: '002b_memory_indexes_timestamp',
        sql: `CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp)`
      },
      {
        name: '002c_memory_indexes_event_type',
        sql: `CREATE INDEX IF NOT EXISTS idx_memories_event_type ON memories(event_type)`
      },
      {
        name: '003_sessions_table',
        sql: `
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            started_at DATETIME NOT NULL,
            ended_at DATETIME,
            workspace_id TEXT,
            metadata TEXT
          );`
      },
      {
        name: '004_git_states_table',
        sql: `
          CREATE TABLE IF NOT EXISTS git_states (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id TEXT NOT NULL,
            branch TEXT NOT NULL,
            commit_hash TEXT NOT NULL,
            is_dirty INTEGER NOT NULL,
            tracked_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );`
      },
      {
        name: '005_git_states_indexes',
        sql: `CREATE INDEX IF NOT EXISTS idx_git_states_workspace ON git_states(workspace_id)`
      },
      {
        name: '005a_git_states_indexes_branch',
        sql: `CREATE INDEX IF NOT EXISTS idx_git_states_branch ON git_states(branch)`
      },
      {
        name: '006_vector_mappings_table',
        sql: `
          CREATE TABLE IF NOT EXISTS vector_mappings (
            memory_id TEXT PRIMARY KEY,
            vector_id TEXT NOT NULL,
            model TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );`
      }
    ];

    // Run each migration
    for (const migration of migrations) {
      await this.runMigration(migration);
    }
    
    logger.debug('All migrations completed');
  }

  private async runMigration(migration: { name: string; sql: string }): Promise<void> {
    // Check if migration has already been applied
    const existing = this.db!.prepare(
      'SELECT id FROM migrations WHERE name = ?'
    ).get(migration.name);

    if (!existing) {
      logger.debug(`Running migration: ${migration.name}`);
      logger.debug(`SQL: ${migration.sql.trim()}`);
      
      // Run in transaction
      const transaction = this.db!.transaction(() => {
        this.db!.exec(migration.sql.trim());
        this.db!.prepare(
          'INSERT INTO migrations (name) VALUES (?)'
        ).run(migration.name);
      });
      
      transaction();
      logger.info(`Migration ${migration.name} applied`);
    }
  }

  async storeMemory(memory: Memory): Promise<Memory & { id: string }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const id = this.generateMemoryId();
    const metadata = memory.metadata ? JSON.stringify(memory.metadata) : null;
    
    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, event_type, content, metadata, timestamp,
        session_id, workspace_id, git_branch, git_commit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      memory.eventType,
      memory.content,
      metadata,
      memory.timestamp.toISOString(),
      memory.sessionId,
      memory.workspaceId || null,
      memory.gitBranch || null,
      memory.gitCommit || null
    );

    return { ...memory, id };
  }

  async getMemory(id: string): Promise<Memory | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const row = this.db.prepare(`
      SELECT * FROM memories WHERE id = ?
    `).get(id) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      eventType: row.event_type,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      timestamp: new Date(row.timestamp),
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      gitBranch: row.git_branch,
      gitCommit: row.git_commit
    };
  }

  async storeMemories(memories: Memory[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const insert = this.db.prepare(`
      INSERT INTO memories (
        id, event_type, content, metadata, timestamp,
        session_id, workspace_id, git_branch, git_commit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((memories: Memory[]) => {
      for (const memory of memories) {
        const id = this.generateMemoryId();
        const metadata = memory.metadata ? JSON.stringify(memory.metadata) : null;
        
        insert.run(
          id,
          memory.eventType,
          memory.content,
          metadata,
          memory.timestamp.toISOString(),
          memory.sessionId,
          memory.workspaceId || null,
          memory.gitBranch || null,
          memory.gitCommit || null
        );
      }
    });

    transaction(memories);
  }

  async get(query: string, params?: any[]): Promise<any> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const stmt = this.db.prepare(query);
    return params ? stmt.get(...params) : stmt.get();
  }

  async all(query: string): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db.prepare(query).all();
  }

  async count(table: string): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any;
    return result.count;
  }

  transaction<T>(fn: (tx: TransactionContext) => T): T {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Create transaction context with synchronous methods
    const context: TransactionContext = {
      run: (query: string, params?: any[]) => {
        const stmt = this.db!.prepare(query);
        return stmt.run(...(params || []));
      },
      get: (query: string, params?: any[]) => {
        const stmt = this.db!.prepare(query);
        return stmt.get(...(params || []));
      },
      all: (query: string, params?: any[]) => {
        const stmt = this.db!.prepare(query);
        return stmt.all(...(params || []));
      }
    };

    // Execute in transaction
    const transaction = this.db.transaction(() => {
      return fn(context);
    });

    return transaction();
  }

  async close(): Promise<void> {
    if (this.db) {
      logger.info('Closing database connection...');
      this.db.close();
      this.db = null;
      logger.info('Database connection closed');
    }
  }

  private generateMemoryId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

interface TransactionContext {
  run(query: string, params?: any[]): any;
  get(query: string, params?: any[]): any;
  all(query: string, params?: any[]): any[];
}