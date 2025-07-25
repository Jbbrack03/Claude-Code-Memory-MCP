import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { FileStore } from "../../src/storage/file-store.js";
import fs from "fs";
import path from "path";

describe('FileStore', () => {
  let store: FileStore;
  const testPath = path.join(process.cwd(), '.test-memory', 'file-test');
  
  beforeEach(async () => {
    // Clean up any existing test directory
    if (fs.existsSync(testPath)) {
      fs.rmSync(testPath, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    // Clean up after tests
    if (store) {
      await store.close();
    }
    if (fs.existsSync(testPath)) {
      fs.rmSync(testPath, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should create directory structure', async () => {
      // Given: A file store with path
      store = new FileStore({ path: testPath });
      
      // When: Store is initialized
      await store.initialize();
      
      // Then: Directory structure is created
      expect(fs.existsSync(testPath)).toBe(true);
      expect(fs.existsSync(path.join(testPath, 'content'))).toBe(true);
      expect(fs.existsSync(path.join(testPath, 'metadata'))).toBe(true);
    });

    it('should handle existing directories', async () => {
      // Given: Directories already exist
      fs.mkdirSync(testPath, { recursive: true });
      fs.mkdirSync(path.join(testPath, 'content'), { recursive: true });
      
      // When: Store is initialized
      store = new FileStore({ path: testPath });
      await store.initialize();
      
      // Then: No error thrown, directories still exist
      expect(fs.existsSync(path.join(testPath, 'metadata'))).toBe(true);
    });
  });

  describe('file storage', () => {
    beforeEach(async () => {
      store = new FileStore({ path: testPath, maxSize: '1MB' });
      await store.initialize();
    });

    it('should store content with checksum', async () => {
      // Given: Content to store
      const content = 'Hello, World!';
      const id = 'test-id-123';
      
      // When: Content is stored
      const checksum = await store.store(id, content);
      
      // Then: Content is stored with checksum
      expect(checksum).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
      
      // And: Files exist in correct locations
      const contentPath = path.join(testPath, 'content', 'te', 'test-id-123.txt');
      const metadataPath = path.join(testPath, 'metadata', 'test-id-123.json');
      expect(fs.existsSync(contentPath)).toBe(true);
      expect(fs.existsSync(metadataPath)).toBe(true);
      
      // And: Content matches
      const storedContent = fs.readFileSync(contentPath, 'utf-8');
      expect(storedContent).toBe(content);
      
      // And: Metadata is correct
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      expect(metadata.id).toBe(id);
      expect(metadata.checksum).toBe(checksum);
      expect(metadata.size).toBe(Buffer.byteLength(content, 'utf-8'));
    });

    it('should use sharding for content files', async () => {
      // Given: Multiple IDs with different prefixes
      const ids = ['aa123', 'bb456', 'cc789'];
      
      // When: Content is stored
      for (const id of ids) {
        await store.store(id, `Content for ${id}`);
      }
      
      // Then: Files are sharded by first two characters
      expect(fs.existsSync(path.join(testPath, 'content', 'aa'))).toBe(true);
      expect(fs.existsSync(path.join(testPath, 'content', 'bb'))).toBe(true);
      expect(fs.existsSync(path.join(testPath, 'content', 'cc'))).toBe(true);
    });

    it('should enforce size limits', async () => {
      // Given: Content exceeding max size (1MB)
      const largeContent = 'x'.repeat(1024 * 1024 + 1); // Just over 1MB
      
      // Then: Store throws size error
      await expect(store.store('large-id', largeContent))
        .rejects.toThrow(/exceeds max size/);
    });

    it('should handle special characters in content', async () => {
      // Given: Content with special characters
      const content = '🚀 Unicode! \n\t"Quotes" & <tags>';
      const id = 'special-chars';
      
      // When: Content is stored and retrieved
      await store.store(id, content);
      const retrieved = await store.retrieve(id);
      
      // Then: Content is preserved exactly
      expect(retrieved).toBe(content);
    });
  });

  describe('file retrieval', () => {
    beforeEach(async () => {
      store = new FileStore({ path: testPath });
      await store.initialize();
    });

    it('should retrieve stored content', async () => {
      // Given: Stored content
      const content = 'Test content';
      const id = 'retrieve-test';
      await store.store(id, content);
      
      // When: Content is retrieved
      const retrieved = await store.retrieve(id);
      
      // Then: Content matches
      expect(retrieved).toBe(content);
    });

    it('should verify checksum on retrieval', async () => {
      // Given: Content with metadata
      const content = 'Checksummed content';
      const id = 'checksum-test';
      await store.store(id, content);
      
      // When: Metadata is corrupted
      const metadataPath = path.join(testPath, 'metadata', `${id}.json`);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      metadata.checksum = 'invalid-checksum';
      fs.writeFileSync(metadataPath, JSON.stringify(metadata));
      
      // Then: Retrieval throws integrity error
      await expect(store.retrieve(id))
        .rejects.toThrow('File integrity check failed');
    });

    it('should handle missing metadata gracefully', async () => {
      // Given: Content without metadata
      const content = 'No metadata';
      const id = 'no-metadata';
      await store.store(id, content);
      
      // When: Metadata is deleted
      const metadataPath = path.join(testPath, 'metadata', `${id}.json`);
      fs.unlinkSync(metadataPath);
      
      // Then: Content can still be retrieved
      const retrieved = await store.retrieve(id);
      expect(retrieved).toBe(content);
    });

    it('should return null for non-existent files', async () => {
      // When: Retrieving non-existent file
      const retrieved = await store.retrieve('non-existent');
      
      // Then: Returns null
      expect(retrieved).toBeNull();
    });
  });

  describe('file operations', () => {
    beforeEach(async () => {
      store = new FileStore({ path: testPath });
      await store.initialize();
    });

    it('should delete files', async () => {
      // Given: A stored file
      const id = 'delete-test';
      await store.store(id, 'Delete me');
      expect(await store.exists(id)).toBe(true);
      
      // When: File is deleted
      const deleted = await store.delete(id);
      
      // Then: File no longer exists
      expect(deleted).toBe(true);
      expect(await store.exists(id)).toBe(false);
      
      // And: Both content and metadata are deleted
      const contentPath = path.join(testPath, 'content', 'de', `${id}.txt`);
      const metadataPath = path.join(testPath, 'metadata', `${id}.json`);
      expect(fs.existsSync(contentPath)).toBe(false);
      expect(fs.existsSync(metadataPath)).toBe(false);
    });

    it('should return false when deleting non-existent file', async () => {
      // When: Deleting non-existent file
      const deleted = await store.delete('non-existent');
      
      // Then: Returns false
      expect(deleted).toBe(false);
    });

    it('should check file existence', async () => {
      // Given: Some files exist
      await store.store('exists', 'I exist');
      
      // Then: Existence checks work
      expect(await store.exists('exists')).toBe(true);
      expect(await store.exists('not-exists')).toBe(false);
    });
  });

  describe('statistics', () => {
    beforeEach(async () => {
      store = new FileStore({ path: testPath });
      await store.initialize();
    });

    it('should calculate statistics', async () => {
      // Given: No files initially
      let stats = await store.getStats();
      expect(stats).toEqual({ count: 0, totalSize: 0 });
      
      // When: Files are stored
      await store.store('file1', 'Content 1'); // 9 bytes
      await store.store('file2', 'Longer content 2'); // 16 bytes
      await store.store('aa123', 'Sharded'); // 7 bytes
      
      // Then: Statistics are accurate
      stats = await store.getStats();
      expect(stats.count).toBe(3);
      expect(stats.totalSize).toBe(9 + 16 + 7);
    });

    it('should handle empty shards in statistics', async () => {
      // Given: Store with content
      await store.store('aa111', 'Test');
      
      // When: Empty shard directory is created
      fs.mkdirSync(path.join(testPath, 'content', 'zz'), { recursive: true });
      
      // Then: Statistics still work
      const stats = await store.getStats();
      expect(stats.count).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should throw when used before initialization', async () => {
      // Given: Uninitialized store
      store = new FileStore({ path: testPath });
      
      // Then: Operations throw
      await expect(store.store('test', 'content'))
        .rejects.toThrow('File store not initialized');
      await expect(store.retrieve('test'))
        .rejects.toThrow('File store not initialized');
      await expect(store.delete('test'))
        .rejects.toThrow('File store not initialized');
    });

    it('should handle invalid size formats', () => {
      // Then: Invalid size throws
      expect(() => new FileStore({ path: testPath, maxSize: 'invalid' }))
        .toThrow('Invalid size format');
    });

    it('should parse size formats correctly', () => {
      // Given: Various size formats
      const configs = [
        { maxSize: '100', expected: 100 },
        { maxSize: '10KB', expected: 10 * 1024 },
        { maxSize: '5MB', expected: 5 * 1024 * 1024 },
        { maxSize: '1GB', expected: 1024 * 1024 * 1024 }
      ];
      
      // Then: Each parses correctly
      for (const config of configs) {
        const testStore = new FileStore({ path: testPath, ...config });
        // Access private property for testing
        expect((testStore as any).maxSize).toBe(config.expected);
      }
    });
  });
});