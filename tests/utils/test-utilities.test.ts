import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { 
  createTestDatabase,
  createTempFile,
  createMockNetworkCall,
  waitForCondition,
  retryOperation,
  generateTestData,
  TestUtilities
} from "./test-utilities.js";

describe('Test Utilities - Advanced Testing Helpers', () => {
  let testUtils: TestUtilities;
  
  beforeEach(() => {
    jest.clearAllMocks();
    testUtils = new TestUtilities();
  });

  afterEach(async () => {
    await testUtils.cleanup().catch(() => {});
  });

  describe('Database testing utilities', () => {
    it('should create isolated test database', async () => {
      // Given: Test database configuration
      const dbConfig = {
        name: 'test_database',
        schema: 'test_schema',
        tables: ['users', 'sessions', 'memories']
      };
      
      // When: Creating test database
      const testDb = await createTestDatabase(dbConfig);
      
      // Then: Should create isolated database
      expect(testDb.connectionString).toContain('test_database');
      expect(testDb.isIsolated).toBe(true);
      expect(testDb.cleanup).toBeDefined();
    });

    it('should handle database creation failures', async () => {
      // Given: Invalid database configuration
      const invalidConfig = {
        name: '', // Invalid empty name
        schema: 'invalid schema name!',
        tables: []
      };
      
      // When: Attempting to create database
      const createPromise = createTestDatabase(invalidConfig);
      
      // Then: Should handle error gracefully
      await expect(createPromise).rejects.toThrow(/Invalid database configuration/);
    });

    it('should create database with seeded data', async () => {
      // Given: Database config with seed data
      const dbConfig = {
        name: 'seeded_test_db',
        schema: 'public',
        tables: ['users'],
        seedData: {
          users: [
            { id: 1, name: 'Test User', email: 'test@example.com' },
            { id: 2, name: 'Another User', email: 'another@example.com' }
          ]
        }
      };
      
      // When: Creating seeded database
      const testDb = await createTestDatabase(dbConfig);
      
      // Then: Should contain seed data
      expect(testDb.seedData).toEqual(dbConfig.seedData);
      expect(testDb.query).toBeDefined();
    });

    it('should support database transactions in tests', async () => {
      // Given: Test database with transaction support
      const testDb = await createTestDatabase({
        name: 'transaction_test_db',
        schema: 'public',
        tables: ['accounts'],
        transactionSupport: true
      });
      
      // When: Using transaction
      const transaction = await testDb.beginTransaction();
      
      // Then: Should provide transaction interface
      expect(transaction.commit).toBeDefined();
      expect(transaction.rollback).toBeDefined();
      expect(transaction.query).toBeDefined();
    });

    it('should cleanup database resources properly', async () => {
      // Given: Created test database
      const testDb = await createTestDatabase({
        name: 'cleanup_test_db',
        schema: 'public',
        tables: ['temp_table']
      });
      
      // When: Cleaning up database
      await testDb.cleanup();
      
      // Then: Should cleanup all resources
      expect(testDb.isConnected()).toBe(false);
      expect(testDb.databaseExists()).toBe(false);
    });
  });

  describe('File system testing utilities', () => {
    it('should create temporary files with content', async () => {
      // Given: File content and options
      const content = 'Test file content\nSecond line';
      const options = {
        extension: '.txt',
        prefix: 'test-file-',
        cleanup: true
      };
      
      // When: Creating temp file
      const tempFile = await createTempFile(content, options);
      
      // Then: Should create file with content
      expect(tempFile.path).toMatch(/test-file-.*\.txt$/);
      expect(tempFile.content).toBe(content);
      expect(tempFile.exists()).toBe(true);
    });

    it('should create temporary directories', async () => {
      // Given: Directory structure
      const structure = {
        'file1.txt': 'Content 1',
        'subdir/file2.json': '{"key": "value"}',
        'subdir/nested/file3.md': '# Test'
      };
      
      // When: Creating temp directory
      const tempDir = await createTempFile(structure, { type: 'directory' });
      
      // Then: Should create directory with structure
      expect(tempDir.type).toBe('directory');
      expect(tempDir.listFiles()).toContain('file1.txt');
      expect(tempDir.getFile('subdir/file2.json').content).toBe('{"key": "value"}');
    });

    it('should handle file creation errors', async () => {
      // Given: Invalid file options
      const invalidOptions = {
        path: '/invalid/path/that/does/not/exist/file.txt',
        permissions: 'invalid'
      };
      
      // When: Creating file with invalid options
      const createPromise = createTempFile('content', invalidOptions);
      
      // Then: Should handle error
      await expect(createPromise).rejects.toThrow(/File creation failed/);
    });

    it('should support binary file creation', async () => {
      // Given: Binary content
      const binaryContent = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // PNG header
      
      // When: Creating binary file
      const binaryFile = await createTempFile(binaryContent, {
        extension: '.png',
        type: 'binary'
      });
      
      // Then: Should handle binary content
      expect(binaryFile.type).toBe('binary');
      expect(binaryFile.size).toBe(4);
      expect(binaryFile.readBuffer()).toEqual(binaryContent);
    });

    it('should cleanup temporary files automatically', async () => {
      // Given: Temp file with auto cleanup
      const tempFile = await createTempFile('temporary content', {
        autoCleanup: true,
        cleanupDelay: 100
      });
      
      const filePath = tempFile.path;
      expect(tempFile.exists()).toBe(true);
      
      // When: Waiting for auto cleanup
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Then: Should be cleaned up
      expect(tempFile.exists()).toBe(false);
    });
  });

  describe('Network testing utilities', () => {
    it('should create mock network calls with responses', async () => {
      // Given: Mock network configuration
      const mockConfig = {
        url: 'https://api.example.com/users',
        method: 'GET',
        response: {
          status: 200,
          body: { users: [{ id: 1, name: 'John' }] },
          headers: { 'Content-Type': 'application/json' }
        }
      };
      
      // When: Creating mock network call
      const mockCall = createMockNetworkCall(mockConfig);
      
      // Then: Should create mock with expected behavior
      expect(mockCall.url).toBe(mockConfig.url);
      expect(mockCall.method).toBe(mockConfig.method);
      
      const response = await mockCall.execute();
      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockConfig.response.body);
    });

    it('should simulate network delays', async () => {
      // Given: Mock with delay
      const mockCall = createMockNetworkCall({
        url: 'https://slow-api.com/data',
        delay: 1000,
        response: { status: 200, body: 'delayed response' }
      });
      
      // When: Executing mock call
      const startTime = Date.now();
      await mockCall.execute();
      const endTime = Date.now();
      
      // Then: Should include delay
      expect(endTime - startTime).toBeGreaterThanOrEqual(1000);
    });

    it('should simulate network failures', async () => {
      // Given: Mock with failure simulation
      const mockCall = createMockNetworkCall({
        url: 'https://failing-api.com/endpoint',
        failure: {
          type: 'timeout',
          after: 500
        }
      });
      
      // When: Executing failing mock
      const executePromise = mockCall.execute();
      
      // Then: Should simulate failure
      await expect(executePromise).rejects.toThrow(/timeout/i);
    });

    it('should track network call history', async () => {
      // Given: Mock network call
      const mockCall = createMockNetworkCall({
        url: 'https://api.example.com/tracked',
        response: { status: 200, body: 'success' }
      });
      
      // When: Making multiple calls
      await mockCall.execute();
      await mockCall.execute();
      await mockCall.execute();
      
      // Then: Should track call history
      const history = mockCall.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0].timestamp).toBeDefined();
      expect(history[0].url).toBe('https://api.example.com/tracked');
    });

    it('should support request/response validation', async () => {
      // Given: Mock with validation
      const mockCall = createMockNetworkCall({
        url: 'https://api.example.com/validate',
        requestValidation: (request) => {
          if (!request.headers['Authorization']) {
            throw new Error('Missing authorization header');
          }
        },
        response: { status: 200, body: 'authorized' }
      });
      
      // When: Making request without auth
      const invalidRequest = mockCall.request({
        headers: {}
      });
      
      // Then: Should fail validation
      await expect(invalidRequest).rejects.toThrow('Missing authorization header');
    });
  });

  describe('Async testing utilities', () => {
    it('should wait for conditions with timeout', async () => {
      // Given: Condition that becomes true
      let conditionMet = false;
      setTimeout(() => { conditionMet = true; }, 500);
      
      // When: Waiting for condition
      const result = await waitForCondition(
        () => conditionMet,
        { timeout: 1000, interval: 100 }
      );
      
      // Then: Should resolve when condition is met
      expect(result).toBe(true);
    });

    it('should timeout when condition never becomes true', async () => {
      // Given: Condition that never becomes true
      const neverTrue = () => false;
      
      // When: Waiting for impossible condition
      const waitPromise = waitForCondition(neverTrue, { timeout: 500 });
      
      // Then: Should timeout
      await expect(waitPromise).rejects.toThrow(/Condition not met within 500ms/);
    });

    it('should retry operations with exponential backoff', async () => {
      // Given: Operation that fails initially then succeeds
      let attempts = 0;
      const flakyOperation = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error(`Attempt ${attempts} failed`);
        }
        return 'success';
      };
      
      // When: Retrying operation
      const result = await retryOperation(flakyOperation, {
        maxAttempts: 5,
        backoff: 'exponential',
        baseDelay: 100
      });
      
      // Then: Should eventually succeed
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should fail after max retry attempts', async () => {
      // Given: Operation that always fails
      const alwaysFails = async () => {
        throw new Error('Persistent failure');
      };
      
      // When: Retrying with limited attempts
      const retryPromise = retryOperation(alwaysFails, {
        maxAttempts: 3,
        backoff: 'linear',
        baseDelay: 50
      });
      
      // Then: Should fail after max attempts
      await expect(retryPromise).rejects.toThrow('Persistent failure');
    });

    it('should handle retry operation timeouts', async () => {
      // Given: Slow operation
      const slowOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'slow result';
      };
      
      // When: Retrying with short timeout
      const retryPromise = retryOperation(slowOperation, {
        maxAttempts: 2,
        operationTimeout: 500
      });
      
      // Then: Should timeout
      await expect(retryPromise).rejects.toThrow(/timeout/i);
    });
  });

  describe('Test data generation', () => {
    it('should generate realistic test data', () => {
      // Given: Data generation schema
      const schema = {
        users: {
          count: 10,
          fields: {
            id: 'incrementalId',
            name: 'fullName',
            email: 'email',
            createdAt: 'recentDate'
          }
        }
      };
      
      // When: Generating test data
      const testData = generateTestData(schema);
      
      // Then: Should generate realistic data
      expect(testData.users).toHaveLength(10);
      expect(testData.users[0]).toHaveProperty('id');
      expect(testData.users[0]).toHaveProperty('name');
      expect(testData.users[0]).toHaveProperty('email');
      expect(testData.users[0].email).toMatch(/\S+@\S+\.\S+/);
    });

    it('should generate data with relationships', () => {
      // Given: Schema with relationships
      const schema = {
        users: {
          count: 5,
          fields: { id: 'incrementalId', name: 'fullName' }
        },
        posts: {
          count: 15,
          fields: {
            id: 'incrementalId',
            title: 'sentence',
            userId: { relation: 'users.id' }
          }
        }
      };
      
      // When: Generating related data
      const testData = generateTestData(schema);
      
      // Then: Should maintain relationships
      expect(testData.posts).toHaveLength(15);
      testData.posts.forEach(post => {
        expect(testData.users.some(user => user.id === post.userId)).toBe(true);
      });
    });

    it('should support custom data generators', () => {
      // Given: Schema with custom generator
      const customGenerators = {
        customId: () => `CUSTOM_${Math.random().toString(36).substr(2, 9)}`,
        statusCode: () => [200, 201, 400, 404, 500][Math.floor(Math.random() * 5)]
      };
      
      const schema = {
        responses: {
          count: 100,
          fields: {
            id: 'customId',
            status: 'statusCode'
          }
        }
      };
      
      // When: Generating with custom generators
      const testData = generateTestData(schema, { customGenerators });
      
      // Then: Should use custom generators
      expect(testData.responses).toHaveLength(100);
      testData.responses.forEach(response => {
        expect(response.id).toMatch(/^CUSTOM_/);
        expect([200, 201, 400, 404, 500]).toContain(response.status);
      });
    });

    it('should generate deterministic data with seed', () => {
      // Given: Schema with seed
      const schema = {
        items: {
          count: 5,
          fields: { id: 'incrementalId', value: 'randomNumber' }
        }
      };
      
      // When: Generating with seed
      const testData1 = generateTestData(schema, { seed: 12345 });
      const testData2 = generateTestData(schema, { seed: 12345 });
      
      // Then: Should generate identical data
      expect(testData1).toEqual(testData2);
    });
  });

  describe('Integration testing utilities', () => {
    it('should provide comprehensive test utilities instance', () => {
      // Given: Test utilities instance
      const utils = new TestUtilities({
        enableLogging: false,
        cleanupTimeout: 5000
      });
      
      // When: Checking available utilities
      // Then: Should provide all utility methods
      expect(utils.createDatabase).toBeDefined();
      expect(utils.createTempFile).toBeDefined();
      expect(utils.mockNetworkCall).toBeDefined();
      expect(utils.waitFor).toBeDefined();
      expect(utils.retry).toBeDefined();
      expect(utils.generateData).toBeDefined();
      expect(utils.cleanup).toBeDefined();
    });

    it('should track all created resources for cleanup', async () => {
      // Given: Utilities instance
      const utils = new TestUtilities();
      
      // When: Creating various resources
      await utils.createDatabase({ name: 'tracked_db' });
      await utils.createTempFile('content', { prefix: 'tracked-' });
      const mockCall = utils.mockNetworkCall({ 
        url: 'http://tracked.com',
        response: { status: 200 } 
      });
      
      // Then: Should track all resources
      const trackedResources = utils.getTrackedResources();
      expect(trackedResources.databases).toHaveLength(1);
      expect(trackedResources.files).toHaveLength(1);
      expect(trackedResources.networkMocks).toHaveLength(1);
    });

    it('should cleanup all resources on disposal', async () => {
      // Given: Utilities with resources
      const utils = new TestUtilities();
      
      await utils.createDatabase({ name: 'cleanup_test_db' });
      await utils.createTempFile('cleanup test', { prefix: 'cleanup-' });
      
      // When: Cleaning up utilities
      await utils.cleanup();
      
      // Then: Should cleanup all resources
      const resources = utils.getTrackedResources();
      expect(resources.databases).toHaveLength(0);
      expect(resources.files).toHaveLength(0);
    });

    it('should handle partial cleanup failures gracefully', async () => {
      // Given: Utilities with mixed cleanup behavior
      const utils = new TestUtilities();
      
      // Create resource that will fail cleanup
      const mockFailingCleanup = jest.fn().mockRejectedValue(new Error('Cleanup failed'));
      utils.addCustomResource('failing-resource', mockFailingCleanup);
      
      // Create resource that will succeed
      await utils.createTempFile('success content');
      
      // When: Cleaning up with failures
      const cleanupResults = await utils.cleanup();
      
      // Then: Should report partial success
      expect(cleanupResults.successful).toBeGreaterThan(0);
      expect(cleanupResults.failed).toBeGreaterThan(0);
      expect(cleanupResults.errors).toHaveLength(1);
    });
  });
});