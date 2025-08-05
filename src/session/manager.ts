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

    // Note: Database tables are created via migrations in SQLiteDatabase

    // Start cleanup interval
    this.startCleanupInterval();
  }

  generateSessionId(): string {
    return `session_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  async createSession(workspaceId: string, metadata: Record<string, unknown> = {}): Promise<Session> {
    logger.info('Creating new session', { workspaceId });

    // Count active sessions
    const activeSessions = await this.getActiveSessions();
    
    // Clean up old sessions if we're at the limit
    if (activeSessions.length >= this.config.maxActiveSessions) {
      await this.cleanupInactiveSessions();
      
      // Check again after cleanup
      const activeAfterCleanup = await this.getActiveSessions();
      if (activeAfterCleanup.length >= this.config.maxActiveSessions) {
        throw new Error(`Maximum active sessions limit reached: ${this.config.maxActiveSessions}`);
      }
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

    if (session && session.isActive && this.isSessionExpired(session)) {
      await this.endSession(sessionId);
      // Return the now-ended session
      return this.sessions.get(sessionId) || null;
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

      // Keep ended sessions in memory for a short time so they can be retrieved
      // They will be cleaned up during the next cleanup cycle
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
    
    const toEnd: string[] = [];
    const toRemove: string[] = [];

    for (const [id, session] of this.sessions) {
      if (session.isActive && this.isSessionExpired(session)) {
        // Session is active but expired, need to end it
        toEnd.push(id);
      } else if (!session.isActive && session.endTime) {
        // Session is already ended, remove from memory after a delay
        const timeSinceEnd = Date.now() - session.endTime.getTime();
        if (timeSinceEnd > 60000) { // Remove after 1 minute
          toRemove.push(id);
        }
      }
    }

    // End expired active sessions
    for (const id of toEnd) {
      await this.endSession(id);
    }

    // Remove old ended sessions from memory
    for (const id of toRemove) {
      this.sessions.delete(id);
    }

    const totalCleaned = toEnd.length + toRemove.length;
    logger.info('Cleaned up sessions', { ended: toEnd.length, removed: toRemove.length, total: totalCleaned });
    return totalCleaned;
  }

  async updateActivity(sessionId: string): Promise<void> {
    logger.debug('Updating session activity', { sessionId });
    
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }

    if (this.config.persistSessions && this.db) {
      await this.updateSessionActivity(sessionId);
    }
  }

  async getActiveSessionsForWorkspace(workspaceId: string): Promise<Session[]> {
    logger.debug('Getting active sessions for workspace', { workspaceId });
    
    const active: Session[] = [];

    // Check in-memory sessions first
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId && 
          session.isActive && 
          !this.isSessionExpired(session)) {
        active.push(session);
      }
    }

    // Check persisted sessions if enabled
    if (this.config.persistSessions && this.db) {
      const persistedSessions = await this.loadActiveSessionsForWorkspace(workspaceId);
      for (const session of persistedSessions) {
        // Only add if not already in memory and not expired
        if (!this.sessions.has(session.id) && !this.isSessionExpired(session)) {
          active.push(session);
          this.sessions.set(session.id, session);
        }
      }
    }

    return active;
  }

  async cleanupExpiredSessions(): Promise<number> {
    logger.debug('Cleaning up expired sessions');
    
    const toRemove: string[] = [];

    // Check in-memory sessions
    for (const [id, session] of this.sessions) {
      if (!session.isActive || this.isSessionExpired(session)) {
        toRemove.push(id);
      }
    }

    // Clean up persisted expired sessions if enabled
    if (this.config.persistSessions && this.db) {
      const expiredCount = await this.cleanupExpiredPersistedSessions();
      logger.debug('Cleaned up expired persisted sessions', { count: expiredCount });
    }

    // End in-memory sessions
    for (const id of toRemove) {
      await this.endSession(id);
    }

    logger.info('Cleaned up expired sessions', { count: toRemove.length });
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

  private async cleanupExpiredPersistedSessions(): Promise<number> {
    if (!this.db) return 0;

    const expiredTime = new Date(Date.now() - this.config.sessionTimeout).toISOString();
    
    const result = this.db.run(
      'UPDATE sessions SET is_active = 0, end_time = ? WHERE is_active = 1 AND last_activity < ?',
      [new Date().toISOString(), expiredTime]
    );

    return result.changes || 0;
  }

  private async persistSession(session: Session): Promise<void> {
    if (!this.db) return;

    this.db.run(
      `INSERT OR REPLACE INTO sessions 
       (id, workspace_id, started_at, start_time, last_activity, end_time, metadata, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.workspaceId,
        session.startTime.toISOString(), // For the legacy started_at column
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