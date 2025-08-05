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
  metadata?: Record<string, unknown>;
  timestamp: Date;
  sessionId: string;
  workspaceId?: string;
  gitBranch?: string;
  gitCommit?: string;
}

interface DatabaseRow {
  id: string;
  event_type: string;
  content: string;
  metadata: string | null;
  timestamp: string;
  session_id: string;
  workspace_id: string | null;
  git_branch: string | null;
  git_commit: string | null;
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
    this.runMigrations();
    
    logger.info('SQLite database initialized');
  }

  private runMigrations(): void {
    logger.debug('Running database migrations...');
    
    // Create migrations table
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    this.db.exec(`
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
        name: '007_update_sessions_schema',
        sql: `
          ALTER TABLE sessions ADD COLUMN start_time TEXT;
          ALTER TABLE sessions ADD COLUMN last_activity TEXT;
          ALTER TABLE sessions ADD COLUMN end_time TEXT;
          ALTER TABLE sessions ADD COLUMN is_active INTEGER DEFAULT 1;
        `
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
      this.runMigration(migration);
    }
    
    logger.debug('All migrations completed');
  }

  private runMigration(migration: { name: string; sql: string }): void {
    // Check if migration has already been applied
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const existing = this.db.prepare(
      'SELECT id FROM migrations WHERE name = ?'
    ).get(migration.name);

    if (!existing) {
      logger.debug(`Running migration: ${migration.name}`);
      logger.debug(`SQL: ${migration.sql.trim()}`);
      
      // Run in transaction
      const transaction = this.db.transaction(() => {
        if (!this.db) {
          throw new Error('Database not initialized');
        }
        this.db.exec(migration.sql.trim());
        this.db.prepare(
          'INSERT INTO migrations (name) VALUES (?)'
        ).run(migration.name);
      });
      
      transaction();
      logger.info(`Migration ${migration.name} applied`);
    }
  }

  storeMemory(memory: Memory): Memory & { id: string } {
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

  getMemory(id: string): Memory | null {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const row = this.db.prepare(`
      SELECT * FROM memories WHERE id = ?
    `).get(id) as DatabaseRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      eventType: row.event_type,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
      timestamp: new Date(row.timestamp),
      sessionId: row.session_id,
      workspaceId: row.workspace_id || undefined,
      gitBranch: row.git_branch || undefined,
      gitCommit: row.git_commit || undefined
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

    // Wrap in Promise to match test expectations
    return new Promise((resolve, reject) => {
      try {
        transaction(memories);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  get(query: string, params?: unknown[]): unknown {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const stmt = this.db.prepare(query);
    return params ? stmt.get(...params) : stmt.get();
  }

  all(query: string, params?: unknown[]): unknown[] {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const stmt = this.db.prepare(query);
    return params ? stmt.all(...params) : stmt.all();
  }

  run(query: string, params?: unknown[]): Database.RunResult {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const stmt = this.db.prepare(query);
    return params ? stmt.run(...params) : stmt.run();
  }

  count(table: string): number {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
    return result.count;
  }

  transaction<T>(fn: (tx: TransactionContext) => T): T {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Create transaction context with synchronous methods
    const context: TransactionContext = {
      run: (query: string, params?: unknown[]) => {
        if (!this.db) {
          throw new Error('Database not initialized');
        }
        const stmt = this.db.prepare(query);
        return stmt.run(...(params || []));
      },
      get: (query: string, params?: unknown[]) => {
        if (!this.db) {
          throw new Error('Database not initialized');
        }
        const stmt = this.db.prepare(query);
        return stmt.get(...(params || []));
      },
      all: (query: string, params?: unknown[]) => {
        if (!this.db) {
          throw new Error('Database not initialized');
        }
        const stmt = this.db.prepare(query);
        return stmt.all(...(params || []));
      }
    };

    // Execute in transaction
    const transaction = this.db.transaction(() => {
      return fn(context);
    });

    return transaction();
  }

  getMemoriesByIds(ids: string[]): Memory[] {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    if (ids.length === 0) {
      return [];
    }
    
    const placeholders = ids.map(() => '?').join(',');
    const query = `
      SELECT * FROM memories 
      WHERE id IN (${placeholders})
    `;
    
    const rows = this.db.prepare(query).all(...ids) as DatabaseRow[];
    
    return rows.map(row => ({
      id: row.id,
      eventType: row.event_type,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
      timestamp: new Date(row.timestamp),
      sessionId: row.session_id,
      workspaceId: row.workspace_id || undefined,
      gitBranch: row.git_branch || undefined,
      gitCommit: row.git_commit || undefined
    }));
  }

  queryMemories(filters: {
    workspaceId?: string;
    sessionId?: string;
    eventType?: string;
    gitBranch?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    orderBy?: string;
    orderDirection?: 'ASC' | 'DESC';
  } = {}): Memory[] {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.workspaceId !== undefined) {
      conditions.push('workspace_id = ?');
      params.push(filters.workspaceId);
    }

    if (filters.sessionId) {
      conditions.push('session_id = ?');
      params.push(filters.sessionId);
    }

    if (filters.eventType) {
      conditions.push('event_type = ?');
      params.push(filters.eventType);
    }

    if (filters.gitBranch) {
      conditions.push('git_branch = ?');
      params.push(filters.gitBranch);
    }

    if (filters.startTime) {
      conditions.push('timestamp >= ?');
      params.push(filters.startTime.toISOString());
    }

    if (filters.endTime) {
      conditions.push('timestamp <= ?');
      params.push(filters.endTime.toISOString());
    }

    let query = 'SELECT * FROM memories';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Add ordering
    const orderBy = filters.orderBy || 'timestamp';
    const orderDirection = filters.orderDirection || 'ASC';
    query += ` ORDER BY ${orderBy} ${orderDirection}`;

    // Add limit
    if (filters.limit) {
      query += ` LIMIT ${filters.limit}`;
    }

    const rows = this.db.prepare(query).all(...params) as DatabaseRow[];

    return rows.map(row => ({
      id: row.id,
      eventType: row.event_type,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
      timestamp: new Date(row.timestamp),
      sessionId: row.session_id,
      workspaceId: row.workspace_id || undefined,
      gitBranch: row.git_branch || undefined,
      gitCommit: row.git_commit || undefined
    }));
  }

  close(): void {
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
  run(query: string, params?: unknown[]): Database.RunResult;
  get(query: string, params?: unknown[]): unknown;
  all(query: string, params?: unknown[]): unknown[];
}