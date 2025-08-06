/**
 * Comprehensive failing tests for BaseHookTemplate
 * Following TDD red phase - these tests will fail initially
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { BaseHookTemplate, HookEvent, HookResponse, HookEventSchema, HookResponseSchema } from '../../../src/hooks/templates/base-template.js';
import { HookEventGenerator } from '../mock/hook-event-generator.js';
import { setupTestTimeouts, setupTestCleanup } from '../../utils/test-helpers.js';

// Test implementation of abstract BaseHookTemplate
class TestHookTemplate extends BaseHookTemplate {
  constructor(hookId: string = 'test-hook', options?: { timeout?: number; maxRetries?: number }) {
    super(hookId, options);
  }

  async process(event: HookEvent): Promise<HookResponse> {
    const validatedEvent = this.validateEvent(event);
    const context = this.extractContext(validatedEvent);
    const sanitizedData = this.sanitizeData(validatedEvent.data);
    
    return this.createSuccessResponse(sanitizedData, context);
  }
}

describe('BaseHookTemplate', () => {
  let template: TestHookTemplate;
  let eventGenerator: HookEventGenerator;

  setupTestTimeouts(10000);
  setupTestCleanup();

  beforeEach(() => {
    template = new TestHookTemplate();
    eventGenerator = new HookEventGenerator();
  });

  afterEach(() => {
    eventGenerator.reset();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      // Given: Default constructor
      const hookTemplate = new TestHookTemplate();
      
      // When: Checking internal state
      // Then: Should have default values (this will fail initially)
      expect((hookTemplate as any).hookId).toBe('test-hook');
      expect((hookTemplate as any).timeout).toBe(5000);
      expect((hookTemplate as any).maxRetries).toBe(3);
    });

    it('should initialize with custom options', () => {
      // Given: Custom options
      const options = { timeout: 10000, maxRetries: 5 };
      
      // When: Creating with options
      const hookTemplate = new TestHookTemplate('custom-hook', options);
      
      // Then: Should use custom values (this will fail initially)
      expect((hookTemplate as any).hookId).toBe('custom-hook');
      expect((hookTemplate as any).timeout).toBe(10000);
      expect((hookTemplate as any).maxRetries).toBe(5);
    });

    it('should handle partial options', () => {
      // Given: Partial options
      const options = { timeout: 8000 };
      
      // When: Creating with partial options
      const hookTemplate = new TestHookTemplate('partial-hook', options);
      
      // Then: Should use provided and default values (this will fail initially)
      expect((hookTemplate as any).hookId).toBe('partial-hook');
      expect((hookTemplate as any).timeout).toBe(8000);
      expect((hookTemplate as any).maxRetries).toBe(3);
    });
  });

  describe('validateEvent', () => {
    it('should validate correct hook events', () => {
      // Given: Valid hook event
      const validEvent = eventGenerator.createUserPromptSubmitEvent('test prompt');
      
      // When: Validating event
      const result = template['validateEvent'](validEvent);
      
      // Then: Should return validated event (this will fail initially)
      expect(result).toEqual(validEvent);
      expect(result.type).toBe('user-prompt-submit');
      expect(result.timestamp).toBeDefined();
      expect(result.data).toBeDefined();
    });

    it('should reject events with missing type', () => {
      // Given: Event without type
      const invalidEvent = eventGenerator.createInvalidEvent({ missingType: true });
      
      // When: Validating invalid event
      // Then: Should throw validation error (this will fail initially)
      expect(() => template['validateEvent'](invalidEvent))
        .toThrow('Invalid hook event');
    });

    it('should reject events with missing timestamp', () => {
      // Given: Event without timestamp
      const invalidEvent = eventGenerator.createInvalidEvent({ missingTimestamp: true });
      
      // When: Validating invalid event
      // Then: Should throw validation error (this will fail initially)
      expect(() => template['validateEvent'](invalidEvent))
        .toThrow('Invalid hook event');
    });

    it('should reject events with missing data', () => {
      // Given: Event without data
      const invalidEvent = eventGenerator.createInvalidEvent({ missingData: true });
      
      // When: Validating invalid event
      // Then: Should throw validation error (this will fail initially)
      expect(() => template['validateEvent'](invalidEvent))
        .toThrow('Invalid hook event');
    });

    it('should reject events with invalid timestamp format', () => {
      // Given: Event with invalid timestamp
      const invalidEvent = eventGenerator.createInvalidEvent({ invalidTimestamp: true });
      
      // When: Validating invalid event
      // Then: Should throw validation error (this will fail initially)
      expect(() => template['validateEvent'](invalidEvent))
        .toThrow('Invalid hook event');
    });

    it('should reject events with malformed data', () => {
      // Given: Event with malformed data
      const invalidEvent = eventGenerator.createInvalidEvent({ malformedData: true });
      
      // When: Validating invalid event
      // Then: Should throw validation error (this will fail initially)
      expect(() => template['validateEvent'](invalidEvent))
        .toThrow('Invalid hook event');
    });
  });

  describe('createSuccessResponse', () => {
    it('should create valid success response with data', () => {
      // Given: Response data
      const data = { result: 'success', count: 42 };
      const metadata = { workspaceId: 'test-workspace', sessionId: 'test-session' };
      
      // When: Creating success response
      const response = template['createSuccessResponse'](data, metadata);
      
      // Then: Should create valid response structure (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
      expect(response.metadata?.hookId).toBe('test-hook');
      expect(response.metadata?.timestamp).toBeDefined();
      expect(response.metadata?.executionTime).toBe(0);
      expect(response.metadata?.workspaceId).toBe('test-workspace');
      expect(response.metadata?.sessionId).toBe('test-session');
    });

    it('should create success response without data', () => {
      // Given: No data
      // When: Creating success response without data
      const response = template['createSuccessResponse']();
      
      // Then: Should create valid response without data (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data).toBeUndefined();
      expect(response.metadata?.hookId).toBe('test-hook');
      expect(response.metadata?.timestamp).toBeDefined();
    });

    it('should validate against HookResponseSchema', () => {
      // Given: Success response
      const response = template['createSuccessResponse']({ test: 'data' });
      
      // When: Validating against schema
      const result = HookResponseSchema.safeParse(response);
      
      // Then: Should be valid (this will fail initially)
      expect(result.success).toBe(true);
    });
  });

  describe('createErrorResponse', () => {
    it('should create valid error response', () => {
      // Given: Error details
      const code = 'TEST_ERROR';
      const message = 'Test error message';
      const details = { context: 'test', severity: 'high' };
      
      // When: Creating error response
      const response = template['createErrorResponse'](code, message, details);
      
      // Then: Should create valid error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(code);
      expect(response.error?.message).toBe(message);
      expect(response.error?.details).toEqual(details);
      expect(response.metadata?.hookId).toBe('test-hook');
      expect(response.metadata?.timestamp).toBeDefined();
    });

    it('should create error response without details', () => {
      // Given: Error without details
      const code = 'SIMPLE_ERROR';
      const message = 'Simple error';
      
      // When: Creating error response
      const response = template['createErrorResponse'](code, message);
      
      // Then: Should create error response without details (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(code);
      expect(response.error?.message).toBe(message);
      expect(response.error?.details).toBeUndefined();
    });

    it('should validate against HookResponseSchema', () => {
      // Given: Error response
      const response = template['createErrorResponse']('VALIDATION_ERROR', 'Test validation error');
      
      // When: Validating against schema
      const result = HookResponseSchema.safeParse(response);
      
      // Then: Should be valid (this will fail initially)
      expect(result.success).toBe(true);
    });
  });

  describe('extractContext', () => {
    it('should extract context from valid event', () => {
      // Given: Event with context
      const event = eventGenerator.createUserPromptSubmitEvent('test', {
        source: 'chat',
        filePath: '/test/file.ts'
      });
      
      // When: Extracting context
      const context = template['extractContext'](event);
      
      // Then: Should extract workspace and session info (this will fail initially)
      expect(context.workspaceId).toBe('/test/workspace');
      expect(context.sessionId).toMatch(/^test-session-/);
    });

    it('should handle missing context', () => {
      // Given: Event without context
      const event: HookEvent = {
        type: 'test',
        timestamp: new Date().toISOString(),
        data: {},
      };
      
      // When: Extracting context
      const context = template['extractContext'](event);
      
      // Then: Should use defaults (this will fail initially)
      expect(context.workspaceId).toBe('unknown');
      expect(context.sessionId).toBe('unknown');
    });

    it('should handle partial context', () => {
      // Given: Event with partial context
      const event: HookEvent = {
        type: 'test',
        timestamp: new Date().toISOString(),
        data: {},
        context: {
          workspacePath: '/partial/workspace',
        },
      };
      
      // When: Extracting context
      const context = template['extractContext'](event);
      
      // Then: Should use provided and default values (this will fail initially)
      expect(context.workspaceId).toBe('/partial/workspace');
      expect(context.sessionId).toBe('unknown');
    });
  });

  describe('sanitizeData', () => {
    it('should sanitize sensitive API keys', () => {
      // Given: Data with API key
      const data = {
        apiKey: 'sk-1234567890',
        api_key: 'key-abcdef',
        normalData: 'safe-value',
      };
      
      // When: Sanitizing data
      const sanitized = template['sanitizeData'](data);
      
      // Then: Should redact sensitive values (this will fail initially)
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.api_key).toBe('[REDACTED]');
      expect(sanitized.normalData).toBe('safe-value');
    });

    it('should sanitize passwords and secrets', () => {
      // Given: Data with sensitive information
      const data = {
        password: 'super-secret',
        secret: 'my-secret-value',
        secretKey: 'secret-key',
        publicInfo: 'public-data',
      };
      
      // When: Sanitizing data
      const sanitized = template['sanitizeData'](data);
      
      // Then: Should redact sensitive values (this will fail initially)
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.secret).toBe('[REDACTED]');
      expect(sanitized.secretKey).toBe('[REDACTED]');
      expect(sanitized.publicInfo).toBe('public-data');
    });

    it('should sanitize tokens and credentials', () => {
      // Given: Data with tokens and credentials
      const data = {
        token: 'bearer-token-123',
        authToken: 'auth-12345',
        credential: 'cred-data',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        normalField: 'normal-value',
      };
      
      // When: Sanitizing data
      const sanitized = template['sanitizeData'](data);
      
      // Then: Should redact sensitive values (this will fail initially)
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.authToken).toBe('[REDACTED]');
      expect(sanitized.credential).toBe('[REDACTED]');
      expect(sanitized.accessToken).toBe('[REDACTED]');
      expect(sanitized.refreshToken).toBe('[REDACTED]');
      expect(sanitized.normalField).toBe('normal-value');
    });

    it('should sanitize nested objects', () => {
      // Given: Nested data with sensitive information
      const data = {
        config: {
          apiKey: 'nested-api-key',
          database: {
            password: 'db-password',
            host: 'localhost',
          },
        },
        metadata: {
          secret: 'nested-secret',
          version: '1.0.0',
        },
      };
      
      // When: Sanitizing data
      const sanitized = template['sanitizeData'](data);
      
      // Then: Should redact nested sensitive values (this will fail initially)
      expect((sanitized.config as any).apiKey).toBe('[REDACTED]');
      expect((sanitized.config as any).database.password).toBe('[REDACTED]');
      expect((sanitized.config as any).database.host).toBe('localhost');
      expect((sanitized.metadata as any).secret).toBe('[REDACTED]');
      expect((sanitized.metadata as any).version).toBe('1.0.0');
    });

    it('should sanitize arrays', () => {
      // Given: Array with sensitive data
      const data = {
        tokens: ['token1', 'secret-token', 'public-data'],
        configs: [
          { apiKey: 'api-1', name: 'config-1' },
          { password: 'pass-2', name: 'config-2' },
        ],
      };
      
      // When: Sanitizing data
      const sanitized = template['sanitizeData'](data);
      
      // Then: Should redact sensitive array values (this will fail initially)
      expect((sanitized.tokens as string[])[0]).toBe('[REDACTED]'); // 'token1' contains 'token'
      expect((sanitized.tokens as string[])[1]).toBe('[REDACTED]'); // 'secret-token' contains both
      expect((sanitized.tokens as string[])[2]).toBe('public-data');
      expect((sanitized.configs as any[])[0].apiKey).toBe('[REDACTED]');
      expect((sanitized.configs as any[])[0].name).toBe('config-1');
      expect((sanitized.configs as any[])[1].password).toBe('[REDACTED]');
      expect((sanitized.configs as any[])[1].name).toBe('config-2');
    });

    it('should handle string values with sensitive patterns', () => {
      // Given: String values that contain sensitive patterns
      const data = {
        message: 'The API key is sk-1234567890',
        description: 'Password reset token: abc123',
        log: 'Authentication successful',
        info: 'Public information',
      };
      
      // When: Sanitizing data
      const sanitized = template['sanitizeData'](data);
      
      // Then: Should redact strings with sensitive patterns (this will fail initially)
      expect(sanitized.message).toBe('[REDACTED]'); // Contains 'API key'
      expect(sanitized.description).toBe('[REDACTED]'); // Contains 'token'
      expect(sanitized.log).toBe('[REDACTED]'); // Contains 'auth'
      expect(sanitized.info).toBe('Public information');
    });

    it('should preserve non-object values', () => {
      // Given: Various non-object values
      const data = {
        number: 42,
        boolean: true,
        nullValue: null,
        undefinedValue: undefined,
        date: new Date('2023-01-01'),
      };
      
      // When: Sanitizing data
      const sanitized = template['sanitizeData'](data);
      
      // Then: Should preserve non-object values (this will fail initially)
      expect(sanitized.number).toBe(42);
      expect(sanitized.boolean).toBe(true);
      expect(sanitized.nullValue).toBeNull();
      expect(sanitized.undefinedValue).toBeUndefined();
      expect(sanitized.date).toEqual(data.date);
    });
  });

  describe('process method (abstract implementation)', () => {
    it('should process valid events successfully', async () => {
      // Given: Valid hook event
      const event = eventGenerator.createUserPromptSubmitEvent('test prompt');
      
      // When: Processing event
      const response = await template.process(event);
      
      // Then: Should return success response (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.metadata?.hookId).toBe('test-hook');
    });

    it('should handle processing errors gracefully', async () => {
      // Given: Invalid event that will cause processing error
      const invalidEvent = eventGenerator.createInvalidEvent({ missingType: true });
      
      // When: Processing invalid event
      // Then: Should throw or handle error appropriately (this will fail initially)
      await expect(template.process(invalidEvent as any))
        .rejects.toThrow('Invalid hook event');
    });

    it('should include execution context in response', async () => {
      // Given: Event with specific context
      const event = eventGenerator.createUserPromptSubmitEvent('test');
      
      // When: Processing event
      const response = await template.process(event);
      
      // Then: Should include context information (this will fail initially)
      expect(response.metadata?.workspaceId).toBe('/test/workspace');
      expect(response.metadata?.sessionId).toMatch(/^test-session-/);
    });

    it('should sanitize sensitive data in response', async () => {
      // Given: Event with sensitive data
      const sensitiveEvent = eventGenerator.createSensitiveDataEvent();
      
      // When: Processing event
      const response = await template.process(sensitiveEvent);
      
      // Then: Should sanitize sensitive data (this will fail initially)
      expect(response.data?.apiKey).toBe('[REDACTED]');
      expect(response.data?.password).toBe('[REDACTED]');
      expect(response.data?.normalData).toBe('this-is-fine');
    });
  });

  describe('schema validation', () => {
    it('should validate HookEventSchema with valid events', () => {
      // Given: Valid hook event
      const event = eventGenerator.createUserPromptSubmitEvent('test');
      
      // When: Validating with schema
      const result = HookEventSchema.safeParse(event);
      
      // Then: Should be valid (this will fail initially)
      expect(result.success).toBe(true);
    });

    it('should reject invalid events with HookEventSchema', () => {
      // Given: Invalid event
      const invalidEvent = { type: 'test' }; // Missing required fields
      
      // When: Validating with schema
      const result = HookEventSchema.safeParse(invalidEvent);
      
      // Then: Should be invalid (this will fail initially)
      expect(result.success).toBe(false);
    });

    it('should validate HookResponseSchema with success responses', () => {
      // Given: Success response
      const response = template['createSuccessResponse']({ test: 'data' });
      
      // When: Validating with schema
      const result = HookResponseSchema.safeParse(response);
      
      // Then: Should be valid (this will fail initially)
      expect(result.success).toBe(true);
    });

    it('should validate HookResponseSchema with error responses', () => {
      // Given: Error response
      const response = template['createErrorResponse']('TEST_ERROR', 'Test error');
      
      // When: Validating with schema
      const result = HookResponseSchema.safeParse(response);
      
      // Then: Should be valid (this will fail initially)
      expect(result.success).toBe(true);
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle extremely large data objects', () => {
      // Given: Large data object
      const largeData = {
        content: 'x'.repeat(10000),
        apiKey: 'sk-large-key',
        normalField: 'normal',
      };
      
      // When: Sanitizing large data
      const sanitized = template['sanitizeData'](largeData);
      
      // Then: Should handle large objects and sanitize appropriately (this will fail initially)
      expect(sanitized.content).toBe('x'.repeat(10000));
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.normalField).toBe('normal');
    });

    it('should handle circular references in data', () => {
      // Given: Data with circular reference
      const data: any = { name: 'test' };
      data.self = data;
      data.apiKey = 'secret-key';
      
      // When: Sanitizing data with circular reference
      // Then: Should handle gracefully without infinite recursion (this will fail initially)
      expect(() => template['sanitizeData'](data)).not.toThrow();
    });

    it('should handle null and undefined context', () => {
      // Given: Event with null context
      const event: HookEvent = {
        type: 'test',
        timestamp: new Date().toISOString(),
        data: {},
        context: null as any,
      };
      
      // When: Extracting context
      const context = template['extractContext'](event);
      
      // Then: Should handle gracefully with defaults (this will fail initially)
      expect(context.workspaceId).toBe('unknown');
      expect(context.sessionId).toBe('unknown');
    });

    it('should handle malformed timestamp in response metadata', () => {
      // Given: Creating response
      const originalDateToISOString = Date.prototype.toISOString;
      Date.prototype.toISOString = () => { throw new Error('Date error'); };
      
      try {
        // When: Creating response with date error
        // Then: Should handle gracefully (this will fail initially)
        expect(() => template['createSuccessResponse']()).not.toThrow();
      } finally {
        Date.prototype.toISOString = originalDateToISOString;
      }
    });
  });
});