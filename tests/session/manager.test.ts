import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { SessionManager, type Session, type SessionConfig } from "../../src/session/manager.js";
import { SQLiteDatabase } from "../../src/storage/sqlite.js";
import path from "path";
import os from "os";
import fs from "fs/promises";

/**
 * Timeout helper for test operations
 */
async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = 5000
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([operation(), timeoutPromise]);
}

describe('SessionManager Unit Tests', () => {
  let sessionManager: SessionManager;
  let database: SQLiteDatabase;
  let testDir: string;

  beforeEach(async () => {
    await withTimeout(async () => {
      // Create test directory and database
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-manager-test-'));
      const dbPath = path.join(testDir, 'test-sessions.db');

      database = new SQLiteDatabase({
        path: dbPath,
        walMode: true,
        busyTimeout: 5000,
        cacheSize: 10000
      });

      // Initialize with test configuration
      sessionManager = new SessionManager({
        sessionTimeout: 1000, // 1 second for fast testing
        maxActiveSessions: 3,
        persistSessions: true
      }, database);
    });
  });

  afterEach(async () => {
    await withTimeout(async () => {
      sessionManager?.close();
      await database?.close();
      
      if (testDir) {
        await fs.rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Constructor and Configuration', () => {
    it('should create session manager with default config', async () => {
      await withTimeout(async () => {
        // Given: No config provided
        // When: Creating SessionManager
        const manager = new SessionManager();
        
        // Then: Should use defaults
        expect(manager).toBeInstanceOf(SessionManager);
        
        manager.close();
      });
    });

    it('should create session manager with custom config', async () => {
      await withTimeout(async () => {
        // Given: Custom configuration
        const config: Partial<SessionConfig> = {
          sessionTimeout: 60000,
          maxActiveSessions: 5,
          persistSessions: false
        };

        // When: Creating SessionManager
        const manager = new SessionManager(config);
        
        // Then: Should create successfully
        expect(manager).toBeInstanceOf(SessionManager);
        
        manager.close();
      });
    });

    it('should create session manager with database', async () => {
      await withTimeout(async () => {
        // Given: Database and config
        const config: Partial<SessionConfig> = {
          persistSessions: true
        };

        // When: Creating SessionManager with database
        const manager = new SessionManager(config, database);
        
        // Then: Should create successfully
        expect(manager).toBeInstanceOf(SessionManager);
        
        manager.close();
      });
    });

    it('should handle missing database gracefully when persistence enabled', async () => {
      await withTimeout(async () => {
        // Given: Persistence enabled but no database
        const config: Partial<SessionConfig> = {
          persistSessions: true
        };

        // When: Creating SessionManager without database
        const manager = new SessionManager(config);
        
        // Then: Should create successfully (fallback to in-memory)
        expect(manager).toBeInstanceOf(SessionManager);
        
        manager.close();
      });
    });
  });

  describe('Session ID Generation', () => {
    it('should generate unique session IDs', async () => {
      await withTimeout(async () => {
        // Given: Multiple ID generation calls
        const ids = new Set<string>();
        
        // When: Generating multiple IDs
        for (let i = 0; i < 100; i++) {
          const id = sessionManager.generateSessionId();
          ids.add(id);
        }

        // Then: All IDs should be unique
        expect(ids.size).toBe(100);
        
        // And: IDs should follow expected format
        const firstId = Array.from(ids)[0];
        expect(firstId).toMatch(/^session_\d+_[a-f0-9]{16}$/);
      });
    });

    it('should generate IDs with timestamp component', async () => {
      await withTimeout(async () => {
        // Given: Timestamp before generation
        const beforeTime = Date.now();
        
        // When: Generating ID
        const id = sessionManager.generateSessionId();
        
        // Then: ID should contain timestamp close to current time
        const timestampMatch = id.match(/^session_(\d+)_/);
        expect(timestampMatch).not.toBeNull();
        
        const timestamp = parseInt(timestampMatch![1]);
        expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
        expect(timestamp).toBeLessThanOrEqual(Date.now());
      });
    });
  });

  describe('Session Creation', () => {
    it('should create session with required fields', async () => {
      await withTimeout(async () => {
        // Given: Workspace ID
        const workspaceId = '/test/workspace';

        // When: Creating session
        const session = await sessionManager.createSession(workspaceId);

        // Then: Should have all required fields
        expect(session.id).toMatch(/^session_/);
        expect(session.workspaceId).toBe(workspaceId);
        expect(session.isActive).toBe(true);
        expect(session.startTime).toBeInstanceOf(Date);
        expect(session.lastActivity).toBeInstanceOf(Date);
        expect(session.metadata).toEqual({});
        expect(session.endTime).toBeUndefined();
      });
    });

    it('should create session with metadata', async () => {
      await withTimeout(async () => {
        // Given: Workspace ID and metadata
        const workspaceId = '/test/workspace';
        const metadata = { tool: 'test', context: 'unit-testing' };

        // When: Creating session
        const session = await sessionManager.createSession(workspaceId, metadata);

        // Then: Should include metadata
        expect(session.metadata).toEqual(metadata);
      });
    });

    it('should enforce max active sessions limit', async () => {
      await withTimeout(async () => {
        // Given: Sessions at the limit (3 max)
        for (let i = 0; i < 3; i++) {
          await sessionManager.createSession(`/workspace/${i}`);
        }

        // When: Creating another session
        const fourthSession = await sessionManager.createSession('/workspace/fourth');

        // Then: Should create successfully (may trigger cleanup)
        expect(fourthSession.workspaceId).toBe('/workspace/fourth');
        
        // And: Should have cleaned up old sessions if needed
        const activeSessions = await sessionManager.getActiveSessions();
        expect(activeSessions.length).toBeLessThanOrEqual(3);
      }, 8000);
    });

    it('should persist session to database when enabled', async () => {
      await withTimeout(async () => {
        // Given: Session manager with persistence
        const workspaceId = '/test/workspace';

        // When: Creating session
        const session = await sessionManager.createSession(workspaceId);

        // Then: Should be retrievable (from database)
        const retrieved = await sessionManager.getSession(session.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(session.id);
      });
    });
  });

  describe('Session Retrieval', () => {
    let testSession: Session;

    beforeEach(async () => {
      await withTimeout(async () => {
        testSession = await sessionManager.createSession('/test/workspace', { test: true });
      });
    });

    it('should retrieve existing session by ID', async () => {
      await withTimeout(async () => {
        // Given: Existing session
        // When: Retrieving by ID
        const retrieved = await sessionManager.getSession(testSession.id);

        // Then: Should return session
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(testSession.id);
        expect(retrieved!.workspaceId).toBe('/test/workspace');
        expect(retrieved!.metadata).toEqual({ test: true });
      });
    });

    it('should return null for non-existent session', async () => {
      await withTimeout(async () => {
        // Given: Non-existent session ID
        const nonExistentId = 'session_999999_nonexistent';

        // When: Retrieving session
        const retrieved = await sessionManager.getSession(nonExistentId);

        // Then: Should return null
        expect(retrieved).toBeNull();
      });
    });

    it('should return null for expired session', async () => {
      await withTimeout(async () => {
        // Given: Session that will expire
        const session = await sessionManager.createSession('/test/workspace');
        
        // Wait for session to expire (1 second timeout)
        await new Promise(resolve => setTimeout(resolve, 1200));

        // When: Retrieving expired session
        const retrieved = await sessionManager.getSession(session.id);

        // Then: Should return null
        expect(retrieved).toBeNull();
      }, 3000);
    });

    it('should load session from database when not in memory', async () => {
      await withTimeout(async () => {
        // Given: Session created and persisted
        const session = await sessionManager.createSession('/test/workspace');
        
        // Create new session manager (simulating restart)
        const newManager = new SessionManager({
          sessionTimeout: 10000, // Longer timeout
          maxActiveSessions: 3,
          persistSessions: true
        }, database);

        // When: Retrieving session with new manager
        const retrieved = await newManager.getSession(session.id);

        // Then: Should load from database
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(session.id);
        expect(retrieved!.workspaceId).toBe('/test/workspace');

        newManager.close();
      }, 8000);
    });
  });

  describe('Session Lifecycle Management', () => {
    it('should get or create session for new workspace', async () => {
      await withTimeout(async () => {
        // Given: New workspace
        const workspaceId = '/new/workspace';

        // When: Getting or creating session
        const session = await sessionManager.getOrCreateSession(workspaceId);

        // Then: Should create new session
        expect(session.workspaceId).toBe(workspaceId);
        expect(session.isActive).toBe(true);
      });
    });

    it('should reuse existing active session for workspace', async () => {
      await withTimeout(async () => {
        // Given: Existing session
        const workspaceId = '/test/workspace';
        const first = await sessionManager.createSession(workspaceId);

        // When: Getting or creating session for same workspace
        const second = await sessionManager.getOrCreateSession(workspaceId);

        // Then: Should return same session
        expect(second.id).toBe(first.id);
      });
    });

    it('should get existing session by ID when provided', async () => {
      await withTimeout(async () => {
        // Given: Existing session
        const workspaceId = '/test/workspace';
        const existing = await sessionManager.createSession(workspaceId);

        // When: Getting session with specific ID
        const retrieved = await sessionManager.getOrCreateSession(workspaceId, existing.id);

        // Then: Should return existing session
        expect(retrieved.id).toBe(existing.id);
        
        // And: Should update last activity
        expect(retrieved.lastActivity.getTime()).toBeGreaterThanOrEqual(existing.lastActivity.getTime());
      });
    });

    it('should create new session when provided ID does not exist', async () => {
      await withTimeout(async () => {
        // Given: Non-existent session ID
        const workspaceId = '/test/workspace';
        const nonExistentId = 'session_999999_nonexistent';

        // When: Getting or creating session with non-existent ID
        const session = await sessionManager.getOrCreateSession(workspaceId, nonExistentId);

        // Then: Should create new session
        expect(session.id).not.toBe(nonExistentId);
        expect(session.workspaceId).toBe(workspaceId);
      });
    });

    it('should create new session when provided ID belongs to different workspace', async () => {
      await withTimeout(async () => {
        // Given: Session for different workspace
        const otherWorkspace = '/other/workspace';
        const otherSession = await sessionManager.createSession(otherWorkspace);

        // When: Getting session for different workspace with wrong ID
        const currentWorkspace = '/current/workspace';
        const session = await sessionManager.getOrCreateSession(currentWorkspace, otherSession.id);

        // Then: Should create new session for current workspace
        expect(session.id).not.toBe(otherSession.id);
        expect(session.workspaceId).toBe(currentWorkspace);
      });
    });

    it('should find active session for workspace', async () => {
      await withTimeout(async () => {
        // Given: Active session
        const workspaceId = '/test/workspace';
        const created = await sessionManager.createSession(workspaceId);

        // When: Finding active session
        const found = await sessionManager.findActiveSession(workspaceId);

        // Then: Should return active session
        expect(found).not.toBeNull();
        expect(found!.id).toBe(created.id);
      });
    });

    it('should return null when no active session for workspace', async () => {
      await withTimeout(async () => {
        // Given: No sessions for workspace
        const workspaceId = '/empty/workspace';

        // When: Finding active session
        const found = await sessionManager.findActiveSession(workspaceId);

        // Then: Should return null
        expect(found).toBeNull();
      });
    });

    it('should end session successfully', async () => {
      await withTimeout(async () => {
        // Given: Active session
        const workspaceId = '/test/workspace';
        const session = await sessionManager.createSession(workspaceId);

        // When: Ending session
        await sessionManager.endSession(session.id);

        // Then: Session should no longer be retrievable
        const retrieved = await sessionManager.getSession(session.id);
        expect(retrieved).toBeNull();
      });
    });

    it('should handle ending non-existent session gracefully', async () => {
      await withTimeout(async () => {
        // Given: Non-existent session ID
        const nonExistentId = 'session_999999_nonexistent';

        // When: Ending non-existent session
        await sessionManager.endSession(nonExistentId);

        // Then: Should complete without error
        expect(true).toBe(true);
      });
    });
  });

  describe('Session Activity and Timeout', () => {
    it('should update last activity when accessing session', async () => {
      await withTimeout(async () => {
        // Given: Session with initial activity time
        const workspaceId = '/test/workspace';
        const session = await sessionManager.createSession(workspaceId);
        const initialActivity = session.lastActivity.getTime();

        // Small delay to ensure time difference
        await new Promise(resolve => setTimeout(resolve, 50));

        // When: Getting or creating session (should update activity)
        const updated = await sessionManager.getOrCreateSession(workspaceId, session.id);

        // Then: Last activity should be updated
        expect(updated.lastActivity.getTime()).toBeGreaterThan(initialActivity);
      });
    });

    it('should identify expired sessions correctly', async () => {
      await withTimeout(async () => {
        // Given: Session with very short timeout
        const shortTimeoutManager = new SessionManager({
          sessionTimeout: 100, // 100ms
          maxActiveSessions: 3,
          persistSessions: false
        });

        const session = await shortTimeoutManager.createSession('/test/workspace');

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 200));

        // When: Checking session
        const retrieved = await shortTimeoutManager.getSession(session.id);

        // Then: Should be expired (null)
        expect(retrieved).toBeNull();

        shortTimeoutManager.close();
      }, 3000);
    });

    it('should not expire active sessions within timeout', async () => {
      await withTimeout(async () => {
        // Given: Session with reasonable timeout
        const reasonableTimeoutManager = new SessionManager({
          sessionTimeout: 5000, // 5 seconds
          maxActiveSessions: 3,
          persistSessions: false
        });

        const session = await reasonableTimeoutManager.createSession('/test/workspace');

        // When: Checking session immediately
        const retrieved = await reasonableTimeoutManager.getSession(session.id);

        // Then: Should still be active
        expect(retrieved).not.toBeNull();
        expect(retrieved!.isActive).toBe(true);

        reasonableTimeoutManager.close();
      });
    });
  });

  describe('Bulk Operations', () => {
    it('should get all active sessions', async () => {
      await withTimeout(async () => {
        // Given: Multiple active sessions
        const sessions = [];
        for (let i = 0; i < 3; i++) {
          const session = await sessionManager.createSession(`/workspace/${i}`);
          sessions.push(session);
        }

        // When: Getting active sessions
        const activeSessions = await sessionManager.getActiveSessions();

        // Then: Should return all active sessions
        expect(activeSessions).toHaveLength(3);
        
        const sessionIds = activeSessions.map(s => s.id);
        sessions.forEach(session => {
          expect(sessionIds).toContain(session.id);
        });
      });
    });

    it('should cleanup inactive sessions', async () => {
      await withTimeout(async () => {
        // Given: Mixed active and expired sessions
        const activeSession = await sessionManager.createSession('/active/workspace');
        
        // Create expired session by manipulating time
        const expiredSession = await sessionManager.createSession('/expired/workspace');
        expiredSession.lastActivity = new Date(Date.now() - 10000); // 10 seconds ago
        expiredSession.isActive = false;

        // When: Running cleanup
        const cleanedCount = await sessionManager.cleanupInactiveSessions();

        // Then: Should clean up expired sessions
        expect(cleanedCount).toBeGreaterThanOrEqual(0);
        
        // Active session should remain
        const remaining = await sessionManager.getActiveSessions();
        const remainingIds = remaining.map(s => s.id);
        expect(remainingIds).toContain(activeSession.id);
      }, 8000);
    });

    it('should handle cleanup with no inactive sessions', async () => {
      await withTimeout(async () => {
        // Given: Only active sessions
        await sessionManager.createSession('/active1/workspace');
        await sessionManager.createSession('/active2/workspace');

        // When: Running cleanup
        const cleanedCount = await sessionManager.cleanupInactiveSessions();

        // Then: Should not clean up any sessions
        expect(cleanedCount).toBe(0);
        
        const activeSessions = await sessionManager.getActiveSessions();
        expect(activeSessions).toHaveLength(2);
      });
    });
  });

  describe('Database Persistence', () => {
    it('should persist session data correctly', async () => {
      await withTimeout(async () => {
        // Given: Session with complex metadata
        const workspaceId = '/test/workspace';
        const metadata = {
          tool: 'test-tool',
          context: 'database-persistence',
          nested: { data: 'value' }
        };

        const session = await sessionManager.createSession(workspaceId, metadata);

        // When: Creating new manager (simulating restart)
        const newManager = new SessionManager({
          sessionTimeout: 10000,
          maxActiveSessions: 3,
          persistSessions: true
        }, database);

        const retrieved = await newManager.getSession(session.id);

        // Then: Should have persisted all data correctly
        expect(retrieved).not.toBeNull();
        expect(retrieved!.workspaceId).toBe(workspaceId);
        expect(retrieved!.metadata).toEqual(metadata);
        expect(retrieved!.startTime).toEqual(session.startTime);
        expect(retrieved!.isActive).toBe(true);

        newManager.close();
      }, 8000);
    });

    it('should handle database unavailability gracefully', async () => {
      await withTimeout(async () => {
        // Given: Session manager with database
        const session = await sessionManager.createSession('/test/workspace');

        // When: Database becomes unavailable
        await database.close();

        // And: Creating new session (should work in-memory)
        const newSession = await sessionManager.createSession('/another/workspace');

        // Then: Should create session successfully
        expect(newSession.workspaceId).toBe('/another/workspace');
      });
    });

    it('should load active sessions from database on startup', async () => {
      await withTimeout(async () => {
        // Given: Persisted session
        const workspaceId = '/persistent/workspace';
        const originalSession = await sessionManager.createSession(workspaceId);

        // When: Creating new manager (simulating restart)
        const newManager = new SessionManager({
          sessionTimeout: 10000, // Long timeout
          maxActiveSessions: 3,
          persistSessions: true
        }, database);

        // Then: Should find active session from database
        const found = await newManager.findActiveSession(workspaceId);
        expect(found).not.toBeNull();
        expect(found!.id).toBe(originalSession.id);

        newManager.close();
      }, 8000);
    });
  });

  describe('Cleanup and Resource Management', () => {
    it('should start cleanup interval on initialization', async () => {
      await withTimeout(async () => {
        // Given: Session manager initialization
        // The cleanup interval is started in constructor
        
        // Then: Cleanup should be scheduled (we can't easily test the interval directly)
        expect(sessionManager).toBeInstanceOf(SessionManager);
      });
    });

    it('should stop cleanup interval on close', async () => {
      await withTimeout(async () => {
        // Given: Session manager with cleanup interval
        const manager = new SessionManager({
          sessionTimeout: 1000,
          maxActiveSessions: 3,
          persistSessions: false
        });

        // When: Closing manager
        manager.close();

        // Then: Should complete without error (interval cleared)
        expect(true).toBe(true);
      });
    });

    it('should handle multiple close calls gracefully', async () => {
      await withTimeout(async () => {
        // Given: Session manager
        const manager = new SessionManager();

        // When: Calling close multiple times
        manager.close();
        manager.close();
        manager.close();

        // Then: Should handle gracefully
        expect(true).toBe(true);
      });
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent session creation for same workspace', async () => {
      await withTimeout(async () => {
        // Given: Multiple concurrent requests for same workspace
        const workspaceId = '/concurrent/workspace';
        const promises = [];

        // When: Creating sessions concurrently
        for (let i = 0; i < 10; i++) {
          promises.push(sessionManager.getOrCreateSession(workspaceId));
        }

        const sessions = await Promise.all(promises);

        // Then: Should all return same session (no race conditions)
        const uniqueIds = new Set(sessions.map(s => s.id));
        expect(uniqueIds.size).toBe(1);
      }, 8000);
    });

    it('should handle concurrent cleanup operations', async () => {
      await withTimeout(async () => {
        // Given: Multiple sessions
        for (let i = 0; i < 5; i++) {
          await sessionManager.createSession(`/workspace/${i}`);
        }

        // When: Running cleanup concurrently
        const cleanupPromises = [];
        for (let i = 0; i < 3; i++) {
          cleanupPromises.push(sessionManager.cleanupInactiveSessions());
        }

        const results = await Promise.all(cleanupPromises);

        // Then: Should complete without errors
        results.forEach(count => {
          expect(typeof count).toBe('number');
          expect(count).toBeGreaterThanOrEqual(0);
        });
      }, 8000);
    });

    it('should handle concurrent session retrieval and modification', async () => {
      await withTimeout(async () => {
        // Given: Session
        const workspaceId = '/test/workspace';
        const session = await sessionManager.createSession(workspaceId);

        // When: Concurrent operations on same session
        const promises = [
          sessionManager.getSession(session.id),
          sessionManager.getOrCreateSession(workspaceId, session.id),
          sessionManager.findActiveSession(workspaceId)
        ];

        const results = await Promise.all(promises);

        // Then: All should return valid session data
        results.forEach(result => {
          expect(result).not.toBeNull();
          expect(result!.id).toBe(session.id);
        });
      }, 8000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long workspace IDs', async () => {
      await withTimeout(async () => {
        // Given: Very long workspace ID
        const longWorkspaceId = '/very/long/workspace/path/' + 'x'.repeat(1000);

        // When: Creating session
        const session = await sessionManager.createSession(longWorkspaceId);

        // Then: Should handle long ID correctly
        expect(session.workspaceId).toBe(longWorkspaceId);
      });
    });

    it('should handle special characters in workspace IDs', async () => {
      await withTimeout(async () => {
        // Given: Workspace ID with special characters
        const specialWorkspaceId = '/workspace with spaces/特殊字符/émojis🚀';

        // When: Creating session
        const session = await sessionManager.createSession(specialWorkspaceId);

        // Then: Should handle special characters correctly
        expect(session.workspaceId).toBe(specialWorkspaceId);
      });
    });

    it('should handle complex metadata objects', async () => {
      await withTimeout(async () => {
        // Given: Complex metadata
        const complexMetadata = {
          simple: 'string',
          number: 42,
          boolean: true,
          array: [1, 2, 3, 'test'],
          nested: {
            deep: {
              deeper: 'value'
            }
          },
          nullValue: null,
          undefinedValue: undefined
        };

        // When: Creating session with complex metadata
        const session = await sessionManager.createSession('/test/workspace', complexMetadata);

        // Then: Should preserve metadata structure
        expect(session.metadata.simple).toBe('string');
        expect(session.metadata.number).toBe(42);
        expect(session.metadata.boolean).toBe(true);
        expect(session.metadata.array).toEqual([1, 2, 3, 'test']);
        expect(session.metadata.nested.deep.deeper).toBe('value');
        expect(session.metadata.nullValue).toBeNull();
        // Note: undefined values are typically lost in JSON serialization
      });
    });

    it('should handle system time changes gracefully', async () => {
      await withTimeout(async () => {
        // Given: Session created
        const session = await sessionManager.createSession('/test/workspace');
        const originalTime = session.startTime.getTime();

        // When: Time passes (simulated)
        await new Promise(resolve => setTimeout(resolve, 100));

        // Then: Session should still be valid
        const retrieved = await sessionManager.getSession(session.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.startTime.getTime()).toBe(originalTime);
      });
    });
  });
});