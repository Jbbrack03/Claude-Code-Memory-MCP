import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SQLiteDatabase } from "../../src/storage/sqlite.js";

describe('SQLiteDatabase', () => {
  let db: SQLiteDatabase;
  const testDbPath = path.join(process.cwd(), '.test-memory', 'test.db');
  
  beforeEach(async () => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterEach(async () => {
    // Clean up after tests
    if (db) {
      await db.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('initialization', () => {
    it('should create database file at specified path', async () => {
      // Given: A database path
      const dbPath = '.test-memory/test.db';
      
      // When: Database is initialized
      db = new SQLiteDatabase({ path: dbPath });
      await db.initialize();
      
      // Then: Database file exists
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('should enable WAL mode when configured', async () => {
      // Given: WAL mode enabled in config with file-based database
      const walTestPath = '.test-memory/wal-test.db';
      db = new SQLiteDatabase({ path: walTestPath, walMode: true });
      
      // When: Database is initialized
      await db.initialize();
      
      // Then: WAL mode is active
      const result = db.get('PRAGMA journal_mode');
      expect((result as any).journal_mode).toBe('wal');
      
      // Cleanup
      await db.close();
      if (fs.existsSync(walTestPath)) {
        fs.unlinkSync(walTestPath);
      }
    });

    it('should run all migrations in order', async () => {
      // Given: Migration files exist
      db = new SQLiteDatabase({ path: ':memory:' });
      
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
      db = new SQLiteDatabase({ path: ':memory:' });
      await db.initialize();
      
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
      db = new SQLiteDatabase({ path: ':memory:' });
      await db.initialize();
      
      const memories = [
        { 
          eventType: 'test', 
          content: 'valid',
          timestamp: new Date(),
          sessionId: 'test'
        },
        { 
          eventType: null as any, // This will fail NOT NULL constraint
          content: 'invalid',
          timestamp: new Date(),
          sessionId: 'test'
        }
      ];
      
      // When: Batch insert fails
      let error: Error | null = null;
      try {
        await db.storeMemories(memories);
      } catch (e) {
        error = e as Error;
      }
      
      // Then: Should have thrown an error
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/NOT NULL constraint failed/);
      
      // And: No memories were stored (transaction rolled back)
      const count = await db.count('memories');
      expect(count).toBe(0);
    });
  });
});