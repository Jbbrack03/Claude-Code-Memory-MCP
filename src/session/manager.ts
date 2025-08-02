import { createLogger } from '../utils/logger.js';
import crypto from 'crypto';
import { SQLiteDatabase } from '../storage/sqlite.js';

const logger = createLogger('SessionManager');

export interface Session {
  id: string;
  workspaceId: string;
  startTime: Date;
  lastActivity: Date;
  endTime?: Date;
  metadata: Record<string, unknown>;
  isActive: boolean;
}

export interface SessionConfig {
  sessionTimeout: number; // milliseconds
  maxActiveSessions: number;
  persistSessions: boolean;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private db?: SQLiteDatabase;
  private config: SessionConfig;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: Partial<SessionConfig> = {}, db?: SQLiteDatabase) {
    this.config = {
      sessionTimeout: 30 * 60 * 1000, // 30 minutes default
      maxActiveSessions: 10,
      persistSessions: true,
      ...config
    };
    this.db = db;

    if (this.config.persistSessions && this.db) {
      this.initializeDatabase();
    }

    // Start cleanup interval
    this.startCleanupInterval();
  }

  generateSessionId(): string {
    return `session_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  async createSession(workspaceId: string, metadata: Record<string, unknown> = {}): Promise<Session> {
    logger.info('Creating new session', { workspaceId });

    // Clean up old sessions if we're at the limit
    if (this.sessions.size >= this.config.maxActiveSessions) {
      await this.cleanupInactiveSessions();
    }

    const session: Session = {
      id: this.generateSessionId(),
      workspaceId,
      startTime: new Date(),
      lastActivity: new Date(),
      metadata,
      isActive: true
    };

    this.sessions.set(session.id, session);

    if (this.config.persistSessions && this.db) {
      await this.persistSession(session);
    }

    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    // Check in-memory cache first
    let session = this.sessions.get(sessionId);
    
    if (!session && this.config.persistSessions && this.db) {
      // Try to load from database
      const loadedSession = await this.loadSession(sessionId);
      if (loadedSession) {
        session = loadedSession;
        this.sessions.set(sessionId, session);
      }
    }

    if (session && this.isSessionExpired(session)) {
      await this.endSession(sessionId);
      return null;
    }

    return session || null;
  }

  async getOrCreateSession(workspaceId: string, sessionId?: string): Promise<Session> {
    // If session ID provided, try to get it
    if (sessionId) {
      const existing = await this.getSession(sessionId);
      if (existing && existing.workspaceId === workspaceId) {
        // Update last activity
        existing.lastActivity = new Date();
        if (this.config.persistSessions && this.db) {
          await this.updateSessionActivity(existing.id);
        }
        return existing;
      }
    }

    // Try to find active session for workspace
    const active = await this.findActiveSession(workspaceId);
    if (active) {
      active.lastActivity = new Date();
      if (this.config.persistSessions && this.db) {
        await this.updateSessionActivity(active.id);
      }
      return active;
    }

    // Create new session
    return this.createSession(workspaceId);
  }

  async findActiveSession(workspaceId: string): Promise<Session | null> {
    // Check in-memory sessions
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId && 
          session.isActive && 
          !this.isSessionExpired(session)) {
        return session;
      }
    }

    // Check persisted sessions if enabled
    if (this.config.persistSessions && this.db) {
      const sessions = await this.loadActiveSessionsForWorkspace(workspaceId);
      for (const session of sessions) {
        if (!this.isSessionExpired(session)) {
          this.sessions.set(session.id, session);
          return session;
        }
      }
    }

    return null;
  }

  async endSession(sessionId: string): Promise<void> {
    logger.info('Ending session', { sessionId });

    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      session.endTime = new Date();

      if (this.config.persistSessions && this.db) {
        await this.persistSessionEnd(session);
      }

      this.sessions.delete(sessionId);
    }
  }

  async getActiveSessions(): Promise<Session[]> {
    const active: Session[] = [];

    for (const session of this.sessions.values()) {
      if (session.isActive && !this.isSessionExpired(session)) {
        active.push(session);
      }
    }

    return active;
  }

  async cleanupInactiveSessions(): Promise<number> {
    logger.debug('Cleaning up inactive sessions');
    
    const toRemove: string[] = [];

    for (const [id, session] of this.sessions) {
      if (!session.isActive || this.isSessionExpired(session)) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      await this.endSession(id);
    }

    logger.info('Cleaned up sessions', { count: toRemove.length });
    return toRemove.length;
  }

  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  private isSessionExpired(session: Session): boolean {
    if (!session.isActive) return true;
    
    const now = Date.now();
    const lastActivity = session.lastActivity.getTime();
    
    return (now - lastActivity) > this.config.sessionTimeout;
  }

  private startCleanupInterval(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      void this.cleanupInactiveSessions();
    }, 5 * 60 * 1000);
  }

  private initializeDatabase(): void {
    if (!this.db) return;

    // Create sessions table if it doesn't exist
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        start_time TEXT NOT NULL,
        last_activity TEXT NOT NULL,
        end_time TEXT,
        metadata TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index for workspace queries
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_sessions_workspace 
      ON sessions(workspace_id, is_active)
    `);
  }

  private async persistSession(session: Session): Promise<void> {
    if (!this.db) return;

    this.db.run(
      `INSERT OR REPLACE INTO sessions 
       (id, workspace_id, start_time, last_activity, end_time, metadata, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.workspaceId,
        session.startTime.toISOString(),
        session.lastActivity.toISOString(),
        session.endTime?.toISOString() || null,
        JSON.stringify(session.metadata),
        session.isActive ? 1 : 0
      ]
    );
  }

  private async loadSession(sessionId: string): Promise<Session | null> {
    if (!this.db) return null;

    const row = this.db.get(
      'SELECT * FROM sessions WHERE id = ?',
      [sessionId]
    ) as any;

    if (!row) return null;

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      startTime: new Date(row.start_time),
      lastActivity: new Date(row.last_activity),
      endTime: row.end_time ? new Date(row.end_time) : undefined,
      metadata: JSON.parse(row.metadata || '{}'),
      isActive: row.is_active === 1
    };
  }

  private async loadActiveSessionsForWorkspace(workspaceId: string): Promise<Session[]> {
    if (!this.db) return [];

    // Use the queryMemories pattern from SQLiteDatabase
    const rows = [] as any[];
    const dbAny = this.db as any;
    if (dbAny.prepare) {
      const stmt = dbAny.prepare(
        'SELECT * FROM sessions WHERE workspace_id = ? AND is_active = 1 ORDER BY last_activity DESC'
      );
      rows.push(...(stmt.all(workspaceId) as any[]));
    }

    return rows.map(row => ({
      id: row.id,
      workspaceId: row.workspace_id,
      startTime: new Date(row.start_time),
      lastActivity: new Date(row.last_activity),
      endTime: row.end_time ? new Date(row.end_time) : undefined,
      metadata: JSON.parse(row.metadata || '{}'),
      isActive: row.is_active === 1
    }));
  }

  private async updateSessionActivity(sessionId: string): Promise<void> {
    if (!this.db) return;

    this.db.run(
      'UPDATE sessions SET last_activity = ? WHERE id = ?',
      [new Date().toISOString(), sessionId]
    );
  }

  private async persistSessionEnd(session: Session): Promise<void> {
    if (!this.db) return;

    this.db.run(
      'UPDATE sessions SET is_active = 0, end_time = ? WHERE id = ?',
      [session.endTime?.toISOString() || new Date().toISOString(), session.id]
    );
  }
}