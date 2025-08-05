import { createLogger } from '../utils/logger.js';
import crypto from 'crypto';
import { SQLiteDatabase } from '../storage/sqlite.js';

const logger = createLogger('SessionManager');

interface SessionRow {
  id: string;
  workspace_id: string;
  started_at: string;
  start_time: string;
  last_activity: string;
  end_time: string | null;
  metadata: string;
  is_active: number;
}

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

  constructor(config: Partial<SessionConfig> = {}, db?: SQLiteDatabase | null) {
    this.config = {
      sessionTimeout: 30 * 60 * 1000, // 30 minutes default
      maxActiveSessions: 10,
      persistSessions: true,
      ...config
    };
    this.db = db || undefined;

    // Note: Database tables are created via migrations in SQLiteDatabase

    // Start cleanup interval
    this.startCleanupInterval();
  }

  generateSessionId(): string {
    return `session_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  createSession(workspaceId: string, metadata: Record<string, unknown> = {}): Session {
    logger.info('Creating new session', { workspaceId });

    // Count active sessions
    const activeSessions = this.getActiveSessions();
    
    // Clean up old sessions if we're at the limit
    if (activeSessions.length >= this.config.maxActiveSessions) {
      this.cleanupInactiveSessions();
      
      // Check again after cleanup
      const activeAfterCleanup = this.getActiveSessions();
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
      this.persistSession(session);
    }

    return session;
  }

  getSession(sessionId: string): Session | null {
    // Check in-memory cache first
    let session = this.sessions.get(sessionId);
    
    if (!session && this.config.persistSessions && this.db) {
      // Try to load from database
      const loadedSession = this.loadSession(sessionId);
      if (loadedSession) {
        session = loadedSession;
        this.sessions.set(sessionId, session);
      }
    }

    if (session && session.isActive && this.isSessionExpired(session)) {
      this.endSession(sessionId);
      // Return the now-ended session
      return this.sessions.get(sessionId) || null;
    }

    return session || null;
  }

  getOrCreateSession(workspaceId: string, sessionId?: string): Session {
    // If session ID provided, try to get it
    if (sessionId) {
      const existing = this.getSession(sessionId);
      if (existing && existing.workspaceId === workspaceId) {
        // Update last activity
        existing.lastActivity = new Date();
        if (this.config.persistSessions && this.db) {
          this.updateSessionActivity(existing.id);
        }
        return existing;
      }
    }

    // Try to find active session for workspace
    const active = this.findActiveSession(workspaceId);
    if (active) {
      active.lastActivity = new Date();
      if (this.config.persistSessions && this.db) {
        this.updateSessionActivity(active.id);
      }
      return active;
    }

    // Create new session
    return this.createSession(workspaceId);
  }

  findActiveSession(workspaceId: string): Session | null {
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
      const sessions = this.loadActiveSessionsForWorkspace(workspaceId);
      for (const session of sessions) {
        if (!this.isSessionExpired(session)) {
          this.sessions.set(session.id, session);
          return session;
        }
      }
    }

    return null;
  }

  endSession(sessionId: string): void {
    logger.info('Ending session', { sessionId });

    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      session.endTime = new Date();

      if (this.config.persistSessions && this.db) {
        this.persistSessionEnd(session);
      }

      // Keep ended sessions in memory for a short time so they can be retrieved
      // They will be cleaned up during the next cleanup cycle
    }
  }

  getActiveSessions(): Session[] {
    const active: Session[] = [];

    for (const session of this.sessions.values()) {
      if (session.isActive && !this.isSessionExpired(session)) {
        active.push(session);
      }
    }

    return active;
  }

  cleanupInactiveSessions(): number {
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
      this.endSession(id);
    }

    // Remove old ended sessions from memory
    for (const id of toRemove) {
      this.sessions.delete(id);
    }

    const totalCleaned = toEnd.length + toRemove.length;
    logger.info('Cleaned up sessions', { ended: toEnd.length, removed: toRemove.length, total: totalCleaned });
    return totalCleaned;
  }

  updateActivity(sessionId: string): void {
    logger.debug('Updating session activity', { sessionId });
    
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }

    if (this.config.persistSessions && this.db) {
      this.updateSessionActivity(sessionId);
    }
  }

  getActiveSessionsForWorkspace(workspaceId: string): Session[] {
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
      const persistedSessions = this.loadActiveSessionsForWorkspace(workspaceId);
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

  cleanupExpiredSessions(): number {
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
      const expiredCount = this.cleanupExpiredPersistedSessions();
      logger.debug('Cleaned up expired persisted sessions', { count: expiredCount });
    }

    // End in-memory sessions
    for (const id of toRemove) {
      this.endSession(id);
    }

    logger.info('Cleaned up expired sessions', { count: toRemove.length });
    return toRemove.length;
  }

  getActiveSession(workspaceId?: string): Session | null {
    // If workspace ID provided, find active session for that workspace
    if (workspaceId) {
      return this.findActiveSession(workspaceId);
    }
    
    // Otherwise, return any active session (most recent)
    const activeSessions = this.getActiveSessions();
    if (activeSessions.length === 0) {
      return null;
    }
    
    // Sort by last activity and return most recent
    activeSessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
    return activeSessions[0] || null;
  }

  getSessionHistory(workspaceId: string, limit: number = 50): Session[] {
    logger.debug('Getting session history', { workspaceId, limit });
    
    const history: Session[] = [];
    
    // Get sessions from memory
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId) {
        history.push(session);
      }
    }
    
    // Get sessions from database if enabled
    if (this.config.persistSessions && this.db) {
      const persistedSessions = this.loadSessionHistory(workspaceId, limit);
      
      // Merge with in-memory sessions, avoiding duplicates
      for (const session of persistedSessions) {
        if (!this.sessions.has(session.id)) {
          history.push(session);
        }
      }
    }
    
    // Sort by start time (newest first) and limit
    history.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
    return history.slice(0, limit);
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

  private cleanupExpiredPersistedSessions(): number {
    if (!this.db) return 0;

    const expiredTime = new Date(Date.now() - this.config.sessionTimeout).toISOString();
    
    const result = this.db.run(
      'UPDATE sessions SET is_active = 0, end_time = ? WHERE is_active = 1 AND last_activity < ?',
      [new Date().toISOString(), expiredTime]
    );

    return result.changes || 0;
  }

  private persistSession(session: Session): void {
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

  private loadSession(sessionId: string): Session | null {
    if (!this.db) return null;

    const row = this.db.get(
      'SELECT * FROM sessions WHERE id = ?',
      [sessionId]
    ) as SessionRow | undefined;

    if (!row) return null;

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      startTime: new Date(row.start_time),
      lastActivity: new Date(row.last_activity),
      endTime: row.end_time ? new Date(row.end_time) : undefined,
      metadata: JSON.parse(row.metadata || '{}') as Record<string, unknown>,
      isActive: row.is_active === 1
    };
  }

  private loadActiveSessionsForWorkspace(workspaceId: string): Session[] {
    if (!this.db) return [];

    const rows = this.db.all(
      'SELECT * FROM sessions WHERE workspace_id = ? AND is_active = 1 ORDER BY last_activity DESC',
      [workspaceId]
    ) as SessionRow[];

    return rows.map(row => ({
      id: row.id,
      workspaceId: row.workspace_id,
      startTime: new Date(row.start_time),
      lastActivity: new Date(row.last_activity),
      endTime: row.end_time ? new Date(row.end_time) : undefined,
      metadata: JSON.parse(row.metadata || '{}') as Record<string, unknown>,
      isActive: row.is_active === 1
    }));
  }

  private updateSessionActivity(sessionId: string): void {
    if (!this.db) return;

    this.db.run(
      'UPDATE sessions SET last_activity = ? WHERE id = ?',
      [new Date().toISOString(), sessionId]
    );
  }

  private persistSessionEnd(session: Session): void {
    if (!this.db) return;

    this.db.run(
      'UPDATE sessions SET is_active = 0, end_time = ? WHERE id = ?',
      [session.endTime?.toISOString() || new Date().toISOString(), session.id]
    );
  }

  private loadSessionHistory(workspaceId: string, limit: number): Session[] {
    if (!this.db) return [];

    const rows = this.db.all(
      'SELECT * FROM sessions WHERE workspace_id = ? ORDER BY start_time DESC LIMIT ?',
      [workspaceId, limit]
    ) as SessionRow[];

    return rows.map(row => ({
      id: row.id,
      workspaceId: row.workspace_id,
      startTime: new Date(row.start_time),
      lastActivity: new Date(row.last_activity),
      endTime: row.end_time ? new Date(row.end_time) : undefined,
      metadata: JSON.parse(row.metadata || '{}') as Record<string, unknown>,
      isActive: row.is_active === 1
    }));
  }
}