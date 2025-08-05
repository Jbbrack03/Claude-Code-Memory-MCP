/**
 * Integration tests for WorkspaceManager and SessionManager
 * Phase 9: CLI Integration
 * 
 * These tests validate the critical integration scenarios between workspace
 * detection and session management that form the foundation of the CLI workflow.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { WorkspaceManager, type WorkspaceMetadata } from "../../src/workspace/manager.js";
import { SessionManager, type Session, type SessionConfig } from "../../src/session/manager.js";
import { SQLiteDatabase } from "../../src/storage/sqlite.js";
import { GitIntegration } from "../../src/git/integration.js";
import { withTimeout, TestCleanupManager } from "../utils/test-helpers.js";
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('WorkspaceManager and SessionManager Integration', () => {
  let workspaceManager: WorkspaceManager;
  let sessionManager: SessionManager;
  let gitIntegration: GitIntegration;
  let database: SQLiteDatabase;
  let cleanupManager: TestCleanupManager;
  let testDir: string;
  let gitDir: string;
  let npmDir: string;

  beforeEach(async () => {
    cleanupManager = new TestCleanupManager();
    
    // Create temporary test directories
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-session-test-'));
    gitDir = path.join(testDir, 'git-project');
    npmDir = path.join(testDir, 'npm-project');
    
    // Set up test directories
    await fs.mkdir(gitDir, { recursive: true });
    await fs.mkdir(npmDir, { recursive: true });
    
    // Initialize test database
    const dbPath = path.join(testDir, 'test.db');
    database = new SQLiteDatabase({ path: dbPath });
    await database.initialize();
    
    // Initialize Git integration
    const gitConfig = {
      hookScripts: new Map(),
      repositoryPaths: [gitDir],
      checkInterval: 5000,
      enableRemoteTracking: true
    };
    gitIntegration = new GitIntegration(gitConfig);
    await gitIntegration.initialize();
    
    // Initialize managers
    workspaceManager = new WorkspaceManager(gitIntegration);
    
    const sessionConfig: SessionConfig = {
      sessionTimeout: 30 * 60 * 1000, // 30 minutes
      maxActiveSessions: 5,
      persistSessions: true
    };
    sessionManager = new SessionManager(sessionConfig, database);
    
    // Register cleanup
    cleanupManager.addResource('database', 'database', async () => {
      await database?.close();
    });
    
    cleanupManager.addResource('git', 'custom', async () => {
      await gitIntegration?.close();
    });
    
    cleanupManager.addResource('testDir', 'file', async () => {
      await fs.rm(testDir, { recursive: true, force: true });
    });
  });

  afterEach(async () => {
    await cleanupManager.cleanup();
  });

  describe('Basic Integration Workflow', () => {
    it('should detect workspace and create associated session', async () => {
      // Given: A Git repository workspace
      await fs.mkdir(path.join(gitDir, '.git'), { recursive: true });
      await withTimeout(
        fs.writeFile(path.join(gitDir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0'),
        5000,
        'Setup git config'
      );
      
      // When: Detecting workspace and creating session
      const workspaceId = await withTimeout(
        workspaceManager.detectWorkspace(gitDir),
        5000,
        'Detect workspace'
      );
      
      const session = await withTimeout(
        sessionManager.createSession(workspaceId, { source: 'cli-integration-test' }),
        5000,
        'Create session'
      );
      
      // Then: Workspace should be detected and session created
      expect(workspaceId).toBe(gitDir);
      expect(session.workspaceId).toBe(workspaceId);
      expect(session.isActive).toBe(true);
      expect(session.metadata.source).toBe('cli-integration-test');
    });

    it('should handle NPM workspace detection with session creation', async () => {
      // Given: An NPM project workspace
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        description: 'Test project for workspace detection'
      };
      await withTimeout(
        fs.writeFile(path.join(npmDir, 'package.json'), JSON.stringify(packageJson, null, 2)),
        5000,
        'Create package.json'
      );
      
      // When: Detecting NPM workspace and creating session
      const workspaceId = await withTimeout(
        workspaceManager.detectWorkspace(npmDir),
        5000,
        'Detect NPM workspace'
      );
      
      const session = await withTimeout(
        sessionManager.createSession(workspaceId, { projectType: 'npm' }),
        5000,
        'Create NPM session'
      );
      
      // Then: NPM workspace should be detected correctly
      expect(workspaceId).toBe(npmDir);
      expect(session.workspaceId).toBe(workspaceId);
      expect(session.metadata.projectType).toBe('npm');
    });
  });

  describe('Session Persistence and Retrieval', () => {
    it('should persist sessions and retrieve them after manager restart', async () => {
      // Given: A workspace with an active session
      const workspaceId = await workspaceManager.detectWorkspace(testDir);
      const originalSession = await sessionManager.createSession(workspaceId, { 
        persistence: 'test',
        timestamp: Date.now()
      });
      
      // When: Restarting session manager (simulating application restart)
      await sessionManager.close();
      
      const newSessionManager = new SessionManager({
        sessionTimeout: 30 * 60 * 1000,
        maxActiveSessions: 5,
        persistSessions: true
      }, database);
      
      const retrievedSession = await withTimeout(
        newSessionManager.getSession(originalSession.id),
        5000,
        'Retrieve persisted session'
      );
      
      // Then: Session should be retrieved with all metadata
      expect(retrievedSession).toBeDefined();
      expect(retrievedSession?.id).toBe(originalSession.id);
      expect(retrievedSession?.workspaceId).toBe(workspaceId);
      expect(retrievedSession?.metadata.persistence).toBe('test');
      
      // Cleanup
      await newSessionManager.close();
    });

    it('should maintain session activity tracking', async () => {
      // Given: A workspace session
      const workspaceId = await workspaceManager.detectWorkspace(testDir);
      const session = await sessionManager.createSession(workspaceId);
      const initialActivity = session.lastActivity;
      
      // When: Updating session activity
      await new Promise(resolve => setTimeout(resolve, 100)); // Ensure time difference
      await withTimeout(
        sessionManager.updateActivity(session.id),
        5000,
        'Update session activity'
      );
      
      const updatedSession = await withTimeout(
        sessionManager.getSession(session.id),
        5000,
        'Get updated session'
      );
      
      // Then: Last activity should be updated
      expect(updatedSession).toBeDefined();
      expect(updatedSession!.lastActivity.getTime()).toBeGreaterThan(initialActivity.getTime());
    });
  });

  describe('Workspace Switching with Session Isolation', () => {
    it('should maintain separate sessions for different workspaces', async () => {
      // Given: Two different workspaces
      await fs.mkdir(path.join(gitDir, '.git'), { recursive: true });
      await fs.writeFile(path.join(gitDir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0');
      await fs.writeFile(path.join(npmDir, 'package.json'), '{"name": "test-project", "version": "1.0.0"}');
      
      const gitWorkspaceId = await workspaceManager.detectWorkspace(gitDir);
      const npmWorkspaceId = await workspaceManager.detectWorkspace(npmDir);
      
      // When: Creating sessions for both workspaces
      const gitSession = await sessionManager.createSession(gitWorkspaceId, { type: 'git' });
      const npmSession = await sessionManager.createSession(npmWorkspaceId, { type: 'npm' });
      
      // Then: Sessions should be isolated per workspace
      expect(gitSession.workspaceId).toBe(gitWorkspaceId);
      expect(npmSession.workspaceId).toBe(npmWorkspaceId);
      expect(gitSession.id).not.toBe(npmSession.id);
      expect(gitSession.metadata.type).toBe('git');
      expect(npmSession.metadata.type).toBe('npm');
    });

    it('should handle workspace switching within same session manager', async () => {
      // Given: Multiple workspaces with active sessions
      const workspace1 = testDir;
      const workspace2 = path.join(testDir, 'subfolder');
      await fs.mkdir(workspace2, { recursive: true });
      
      const session1 = await sessionManager.createSession(workspace1, { order: 1 });
      const session2 = await sessionManager.createSession(workspace2, { order: 2 });
      
      // When: Retrieving active sessions for different workspaces
      const workspace1Sessions = await withTimeout(
        sessionManager.getActiveSessionsForWorkspace(workspace1),
        5000,
        'Get workspace1 sessions'
      );
      
      const workspace2Sessions = await withTimeout(
        sessionManager.getActiveSessionsForWorkspace(workspace2),
        5000,
        'Get workspace2 sessions'
      );
      
      // Then: Each workspace should have its own sessions
      expect(workspace1Sessions).toHaveLength(1);
      expect(workspace2Sessions).toHaveLength(1);
      expect(workspace1Sessions[0].id).toBe(session1.id);
      expect(workspace2Sessions[0].id).toBe(session2.id);
    });
  });

  describe('Error Handling Scenarios', () => {
    it('should handle workspace detection failure gracefully', async () => {
      // Given: A non-existent directory
      const nonExistentPath = path.join(testDir, 'nonexistent', 'deeply', 'nested');
      
      // When: Attempting to detect workspace in non-existent location
      const detectWorkspace = async () => {
        return await withTimeout(
          workspaceManager.detectWorkspace(nonExistentPath),
          5000,
          'Detect workspace in non-existent path'
        );
      };
      
      // Then: Should handle error gracefully or return fallback workspace
      await expect(detectWorkspace()).rejects.toThrow();
    });

    it('should handle session creation with invalid workspace ID', async () => {
      // Given: An invalid workspace ID
      const invalidWorkspaceId = '/invalid/workspace/path';
      
      // When: Attempting to create session with invalid workspace
      const createInvalidSession = async () => {
        return await withTimeout(
          sessionManager.createSession(invalidWorkspaceId, { invalid: true }),
          5000,
          'Create session with invalid workspace'
        );
      };
      
      // Then: Should either reject or handle gracefully
      // (Implementation should decide whether to validate workspace IDs)
      const session = await createInvalidSession();
      expect(session.workspaceId).toBe(invalidWorkspaceId);
      expect(session.isActive).toBe(true);
    });

    it('should handle database connection failures for session persistence', async () => {
      // Given: A session manager with closed database
      await database.close();
      
      const sessionManagerWithClosedDb = new SessionManager({
        persistSessions: true
      }, database);
      
      // When: Attempting to create session with closed database
      const createSessionWithClosedDb = async () => {
        return await withTimeout(
          sessionManagerWithClosedDb.createSession('/test/workspace'),
          5000,
          'Create session with closed database'
        );
      };
      
      // Then: Should handle database failure gracefully
      await expect(createSessionWithClosedDb()).rejects.toThrow();
      
      // Cleanup
      await sessionManagerWithClosedDb.close();
    });
  });

  describe('CLI Integration Workflow', () => {
    it('should support complete CLI startup workflow', async () => {
      // Given: A CLI session starting in a project directory
      await fs.mkdir(path.join(gitDir, '.git'), { recursive: true });
      await fs.writeFile(path.join(gitDir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0');
      
      // When: Simulating CLI startup sequence
      const workspaceId = await withTimeout(
        workspaceManager.detectWorkspace(gitDir),
        5000,
        'CLI workspace detection'
      );
      
      const session = await withTimeout(
        sessionManager.createSession(workspaceId, { 
          source: 'cli-startup',
          cwd: gitDir,
          startTime: new Date()
        }),
        5000,
        'CLI session creation'
      );
      
      // Simulate activity during CLI session
      await new Promise(resolve => setTimeout(resolve, 50));
      await sessionManager.updateActivity(session.id);
      
      // When: CLI session ends
      await withTimeout(
        sessionManager.endSession(session.id),
        5000,
        'CLI session end'
      );
      
      const endedSession = await sessionManager.getSession(session.id);
      
      // Then: Complete workflow should work seamlessly
      expect(workspaceId).toBe(gitDir);
      expect(session.workspaceId).toBe(workspaceId);
      expect(session.metadata.source).toBe('cli-startup');
      expect(endedSession?.isActive).toBe(false);
      expect(endedSession?.endTime).toBeDefined();
    });

    it('should handle concurrent CLI sessions in same workspace', async () => {
      // Given: A workspace directory
      const workspaceId = await workspaceManager.detectWorkspace(testDir);
      
      // When: Creating multiple concurrent CLI sessions
      const sessionPromises = Array.from({ length: 3 }, (_, i) =>
        sessionManager.createSession(workspaceId, { 
          sessionNumber: i + 1,
          concurrent: true
        })
      );
      
      const sessions = await withTimeout(
        Promise.all(sessionPromises),
        10000,
        'Create concurrent sessions'
      );
      
      // Then: All sessions should be created and isolated
      expect(sessions).toHaveLength(3);
      sessions.forEach((session, index) => {
        expect(session.workspaceId).toBe(workspaceId);
        expect(session.metadata.sessionNumber).toBe(index + 1);
        expect(session.isActive).toBe(true);
      });
      
      // Verify session isolation
      const sessionIds = sessions.map(s => s.id);
      expect(new Set(sessionIds).size).toBe(3); // All unique IDs
    });
  });

  describe('Memory and Resource Management', () => {
    it('should clean up expired sessions automatically', async () => {
      // Given: A session manager with short timeout
      const shortTimeoutSessionManager = new SessionManager({
        sessionTimeout: 100, // 100ms for quick test
        maxActiveSessions: 10,
        persistSessions: false
      });
      
      const workspaceId = await workspaceManager.detectWorkspace(testDir);
      const session = await shortTimeoutSessionManager.createSession(workspaceId);
      
      // When: Waiting for session to expire
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Trigger cleanup manually (in real implementation this would be automatic)
      await withTimeout(
        shortTimeoutSessionManager.cleanupExpiredSessions(),
        5000,
        'Cleanup expired sessions'
      );
      
      const expiredSession = await shortTimeoutSessionManager.getSession(session.id);
      
      // Then: Session should be expired and cleaned up
      expect(expiredSession?.isActive).toBe(false);
      
      // Cleanup
      await shortTimeoutSessionManager.close();
    });

    it('should enforce maximum active sessions limit', async () => {
      // Given: A session manager with low max sessions limit
      const limitedSessionManager = new SessionManager({
        maxActiveSessions: 2,
        persistSessions: false
      });
      
      const workspaceId = await workspaceManager.detectWorkspace(testDir);
      
      // When: Creating sessions beyond the limit
      const session1 = await limitedSessionManager.createSession(workspaceId, { order: 1 });
      const session2 = await limitedSessionManager.createSession(workspaceId, { order: 2 });
      
      const createThirdSession = async () => {
        return await withTimeout(
          limitedSessionManager.createSession(workspaceId, { order: 3 }),
          5000,
          'Create third session beyond limit'
        );
      };
      
      // Then: Should either reject or cleanup old sessions
      await expect(createThirdSession()).rejects.toThrow();
      
      // Verify first two sessions are still active
      expect((await limitedSessionManager.getSession(session1.id))?.isActive).toBe(true);
      expect((await limitedSessionManager.getSession(session2.id))?.isActive).toBe(true);
      
      // Cleanup
      await limitedSessionManager.close();
    });
  });
});