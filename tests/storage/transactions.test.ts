import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { SQLiteDatabase } from "../../src/storage/sqlite.js";

describe('TransactionManager', () => {
  let db: SQLiteDatabase;

  beforeEach(async () => {
    db = new SQLiteDatabase({ path: ':memory:' });
    await db.initialize();
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  it('should execute successful transaction', async () => {
    // Given: A transaction function
    const result = db.transaction((tx) => {
      tx.run('INSERT INTO memories (id, event_type, content, timestamp, session_id) VALUES (?, ?, ?, ?, ?)', 
        ['1', 'test', 'content', new Date().toISOString(), 'session1']);
      return tx.get('SELECT * FROM memories WHERE id = ?', ['1']);
    });
    
    // Then: Transaction completes and returns result
    expect(result.content).toBe('content');
  });

  it('should rollback transaction on error', async () => {
    // Given: A failing transaction
    try {
      db.transaction((tx) => {
        tx.run('INSERT INTO memories (id, event_type, content, timestamp, session_id) VALUES (?, ?, ?, ?, ?)', 
          ['2', 'test', 'content', new Date().toISOString(), 'session1']);
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
    db.transaction((tx1) => {
      tx1.run('INSERT INTO sessions (id, started_at) VALUES (?, ?)', 
        ['s1', new Date().toISOString()]);
      
      db.transaction((tx2) => {
        tx2.run('INSERT INTO memories (id, event_type, content, timestamp, session_id) VALUES (?, ?, ?, ?, ?)', 
          ['m1', 'test', 'content', new Date().toISOString(), 's1']);
      });
    });
    
    // Then: Both operations complete
    const sessionExists = await db.get('SELECT COUNT(*) as count FROM sessions WHERE id = ?', ['s1']);
    const memoryExists = await db.get('SELECT COUNT(*) as count FROM memories WHERE id = ?', ['m1']);
    expect(sessionExists.count).toBe(1);
    expect(memoryExists.count).toBe(1);
  });
});