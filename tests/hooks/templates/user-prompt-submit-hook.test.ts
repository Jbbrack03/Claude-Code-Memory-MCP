/**
 * Comprehensive failing tests for UserPromptSubmitHook
 * Following TDD red phase - these tests will fail initially
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { UserPromptSubmitHook, createUserPromptSubmitHook } from '../../../src/hooks/templates/user-prompt-submit-hook.js';
import { HookEventGenerator } from '../mock/hook-event-generator.js';
import { MockHookEnvironment } from '../mock/mock-hook-environment.js';
import { setupTestTimeouts, setupTestCleanup } from '../../utils/test-helpers.js';

describe('UserPromptSubmitHook', () => {
  let hook: UserPromptSubmitHook;
  let eventGenerator: HookEventGenerator;
  let mockEnvironment: MockHookEnvironment;

  setupTestTimeouts(10000);
  setupTestCleanup();

  beforeEach(() => {
    hook = new UserPromptSubmitHook();
    eventGenerator = new HookEventGenerator();
    mockEnvironment = new MockHookEnvironment();
  });

  afterEach(() => {
    eventGenerator.reset();
    mockEnvironment.reset();
  });

  describe('constructor', () => {
    it('should initialize with correct hook configuration', () => {
      // Given: UserPromptSubmitHook constructor
      // When: Creating new instance
      const newHook = new UserPromptSubmitHook();
      
      // Then: Should have correct configuration (this will fail initially)
      expect((newHook as any).hookId).toBe('user-prompt-submit-hook');
      expect((newHook as any).timeout).toBe(3000);
      expect((newHook as any).maxRetries).toBe(2);
    });

    it('should be creatable via factory function', () => {
      // Given: Factory function
      // When: Creating hook via factory
      const factoryHook = createUserPromptSubmitHook();
      
      // Then: Should create instance with correct type (this will fail initially)
      expect(factoryHook).toBeInstanceOf(UserPromptSubmitHook);
      expect((factoryHook as any).hookId).toBe('user-prompt-submit-hook');
    });
  });

  describe('process method - basic functionality', () => {
    it('should process valid prompt submit events', async () => {
      // Given: Valid prompt submit event
      const event = eventGenerator.createUserPromptSubmitEvent('How do I implement this feature?');
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should return success response with memory data (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.type).toBe('user_prompt');
      expect(response.data?.content).toBe('How do I implement this feature?');
      expect(response.data?.capture).toBe(true);
      expect(response.data?.indexing).toEqual({
        enabled: true,
        priority: 'high',
      });
    });

    it('should include prompt metadata in response', async () => {
      // Given: Event with metadata
      const event = eventGenerator.createUserPromptSubmitEvent('Test prompt', {
        source: 'file',
        filePath: '/test/file.ts',
        lineNumber: 42,
        language: 'typescript',
      });
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should include metadata (this will fail initially)
      expect(response.data?.metadata?.source).toBe('file');
      expect(response.data?.metadata?.filePath).toBe('/test/file.ts');
      expect(response.data?.metadata?.lineNumber).toBe(42);
      expect(response.data?.metadata?.language).toBe('typescript');
    });

    it('should default source to chat when not provided', async () => {
      // Given: Event without metadata
      const event = eventGenerator.createUserPromptSubmitEvent('Simple prompt');
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should default source to chat (this will fail initially)
      expect(response.data?.metadata?.source).toBe('chat');
    });

    it('should include context information', async () => {
      // Given: Event with context
      const event = eventGenerator.createUserPromptSubmitEvent('Context test');
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should include context in metadata (this will fail initially)
      expect(response.metadata?.workspaceId).toBe('/test/workspace');
      expect(response.metadata?.sessionId).toMatch(/^test-session-/);
    });
  });

  describe('prompt validation', () => {
    it('should reject empty prompts', async () => {
      // Given: Empty prompt event
      const event = eventGenerator.createUserPromptSubmitEvent('');
      
      // When: Processing empty prompt
      const response = await hook.process(event);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('EMPTY_PROMPT');
      expect(response.error?.message).toBe('User prompt cannot be empty');
    });

    it('should reject whitespace-only prompts', async () => {
      // Given: Whitespace-only prompt
      const event = eventGenerator.createUserPromptSubmitEvent('   \n\t  \r\n  ');
      
      // When: Processing whitespace prompt
      const response = await hook.process(event);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('EMPTY_PROMPT');
      expect(response.error?.message).toBe('User prompt cannot be empty');
    });

    it('should reject prompts exceeding maximum length', async () => {
      // Given: Very large prompt (over 100,000 characters)
      const largePrompt = 'x'.repeat(100001);
      const event = eventGenerator.createUserPromptSubmitEvent(largePrompt);
      
      // When: Processing large prompt
      const response = await hook.process(event);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('PROMPT_TOO_LARGE');
      expect(response.error?.message).toBe('User prompt exceeds maximum length of 100,000 characters');
      expect(response.error?.details?.actualLength).toBe(100001);
    });

    it('should accept prompts at maximum length boundary', async () => {
      // Given: Prompt at exactly 100,000 characters
      const maxPrompt = 'x'.repeat(100000);
      const event = eventGenerator.createUserPromptSubmitEvent(maxPrompt);
      
      // When: Processing max-length prompt
      const response = await hook.process(event);
      
      // Then: Should succeed (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.content).toBe(maxPrompt);
    });
  });

  describe('data sanitization', () => {
    it('should sanitize sensitive data in prompts', async () => {
      // Given: Prompt with sensitive information
      const sensitivePrompt = 'My API key is sk-1234567890 and password is secret123';
      const event = eventGenerator.createUserPromptSubmitEvent(sensitivePrompt);
      
      // When: Processing sensitive prompt
      const response = await hook.process(event);
      
      // Then: Should sanitize sensitive data (this will fail initially)
      expect(response.data?.content).toBe('[REDACTED]');
    });

    it('should preserve non-sensitive prompt content', async () => {
      // Given: Prompt without sensitive information
      const safePrompt = 'How do I create a React component?';
      const event = eventGenerator.createUserPromptSubmitEvent(safePrompt);
      
      // When: Processing safe prompt
      const response = await hook.process(event);
      
      // Then: Should preserve original content (this will fail initially)
      expect(response.data?.content).toBe(safePrompt);
    });

    it('should sanitize sensitive metadata', async () => {
      // Given: Event with sensitive metadata
      const event = eventGenerator.createUserPromptSubmitEvent('Test prompt', {
        source: 'file',
        filePath: '/secrets/api-keys.txt',
        apiKey: 'sk-secret-key',
      } as any);
      
      // When: Processing event
      const response = await hook.process(event);
      
      // Then: Should sanitize metadata (this will fail initially)
      expect(response.data?.metadata?.filePath).toBe('/secrets/api-keys.txt');
      expect((response.data?.metadata as any)?.apiKey).toBe('[REDACTED]');
    });
  });

  describe('prompt metadata extraction', () => {
    it('should detect code blocks in prompts', async () => {
      // Given: Prompt with code blocks
      const codePrompt = `
        How do I fix this code?
        \`\`\`typescript
        function test() {
          console.log("hello");
        }
        \`\`\`
        \`\`\`javascript
        const x = 42;
        \`\`\`
      `;
      const event = eventGenerator.createUserPromptSubmitEvent(codePrompt);
      
      // When: Processing prompt with code
      const response = await hook.process(event);
      
      // Then: Should detect code blocks (this will fail initially - method needs to be exposed)
      // Note: This test will need the extractPromptMetadata method to be called and included in response
      expect(response.data?.hasCode).toBe(true);
      expect(response.data?.codeLanguages).toEqual(['typescript', 'javascript']);
    });

    it('should detect file references in prompts', async () => {
      // Given: Prompt with file references
      const filePrompt = 'Please check ./src/components/Button.tsx and ../utils/helper.js';
      const event = eventGenerator.createUserPromptSubmitEvent(filePrompt);
      
      // When: Processing prompt
      const response = await hook.process(event);
      
      // Then: Should detect file references (this will fail initially)
      expect(response.data?.fileReferences).toEqual(['./src/components/Button.tsx', '../utils/helper.js']);
    });

    it('should identify questions', async () => {
      // Given: Prompt that is a question
      const questionPrompt = 'How do I implement authentication? What is the best approach?';
      const event = eventGenerator.createUserPromptSubmitEvent(questionPrompt);
      
      // When: Processing question prompt
      const response = await hook.process(event);
      
      // Then: Should identify as question (this will fail initially)
      expect(response.data?.isQuestion).toBe(true);
    });

    it('should detect commands', async () => {
      // Given: Prompt that starts with command
      const commandPrompt = '/help me with this issue';
      const event = eventGenerator.createUserPromptSubmitEvent(commandPrompt);
      
      // When: Processing command prompt
      const response = await hook.process(event);
      
      // Then: Should detect command (this will fail initially)
      expect(response.data?.hasCommand).toBe(true);
    });

    it('should calculate prompt complexity', async () => {
      // Given: Prompts of different complexities
      const simplePrompt = 'Hi there';
      const moderatePrompt = 'How do I create a React component with TypeScript and proper error handling?';
      const complexPrompt = 'I need to implement a comprehensive authentication system with JWT tokens, refresh mechanisms, role-based access control, and secure password hashing. The system should integrate with OAuth providers, support multi-factor authentication, and include audit logging. Please provide detailed implementation steps, code examples, error handling strategies, and security best practices.';
      
      // When: Processing prompts
      const simpleResponse = await hook.process(eventGenerator.createUserPromptSubmitEvent(simplePrompt));
      const moderateResponse = await hook.process(eventGenerator.createUserPromptSubmitEvent(moderatePrompt));
      const complexResponse = await hook.process(eventGenerator.createUserPromptSubmitEvent(complexPrompt));
      
      // Then: Should calculate complexity correctly (this will fail initially)
      expect(simpleResponse.data?.complexity).toBe('simple');
      expect(moderateResponse.data?.complexity).toBe('moderate');
      expect(complexResponse.data?.complexity).toBe('very_complex');
    });
  });

  describe('event validation', () => {
    it('should reject events with invalid schema', async () => {
      // Given: Event with invalid data schema
      const invalidEvent = eventGenerator.createUserPromptSubmitEvent('test');
      delete (invalidEvent.data as any).prompt; // Remove required field
      
      // When: Processing invalid event
      const response = await hook.process(invalidEvent);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('HOOK_PROCESSING_ERROR');
    });

    it('should reject events missing timestamp', async () => {
      // Given: Event with missing timestamp in data
      const event = eventGenerator.createUserPromptSubmitEvent('test');
      delete (event.data as any).timestamp;
      
      // When: Processing event
      const response = await hook.process(event);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('HOOK_PROCESSING_ERROR');
    });

    it('should handle invalid metadata gracefully', async () => {
      // Given: Event with invalid metadata
      const event = eventGenerator.createUserPromptSubmitEvent('test');
      (event.data as any).metadata = 'invalid-metadata'; // Should be object
      
      // When: Processing event
      const response = await hook.process(event);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('HOOK_PROCESSING_ERROR');
    });
  });

  describe('error handling', () => {
    it('should handle processing errors gracefully', async () => {
      // Given: Hook that will throw during processing
      const originalValidateEvent = hook['validateEvent'];
      hook['validateEvent'] = () => { throw new Error('Validation failed'); };
      
      const event = eventGenerator.createUserPromptSubmitEvent('test');
      
      try {
        // When: Processing with error
        const response = await hook.process(event);
        
        // Then: Should return error response (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.code).toBe('HOOK_PROCESSING_ERROR');
        expect(response.error?.message).toBe('Validation failed');
      } finally {
        hook['validateEvent'] = originalValidateEvent;
      }
    });

    it('should include error stack in details for debugging', async () => {
      // Given: Hook that will throw with stack trace
      const originalSanitizeData = hook['sanitizeData'];
      hook['sanitizeData'] = () => { 
        const error = new Error('Sanitization failed');
        error.stack = 'Error stack trace here';
        throw error;
      };
      
      const event = eventGenerator.createUserPromptSubmitEvent('test');
      
      try {
        // When: Processing with error
        const response = await hook.process(event);
        
        // Then: Should include stack trace (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.details?.error).toBe('Error stack trace here');
      } finally {
        hook['sanitizeData'] = originalSanitizeData;
      }
    });

    it('should handle non-Error exceptions', async () => {
      // Given: Hook that throws non-Error object
      const originalExtractContext = hook['extractContext'];
      hook['extractContext'] = () => { throw 'String error'; };
      
      const event = eventGenerator.createUserPromptSubmitEvent('test');
      
      try {
        // When: Processing with non-Error exception
        const response = await hook.process(event);
        
        // Then: Should handle gracefully (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.message).toBe('Failed to process user prompt submit event');
      } finally {
        hook['extractContext'] = originalExtractContext;
      }
    });
  });

  describe('integration with mock environment', () => {
    it('should execute successfully in mock environment', async () => {
      // Given: Hook and mock environment
      const event = eventGenerator.createUserPromptSubmitEvent('Test in environment');
      
      // When: Executing in mock environment
      const response = await mockEnvironment.executeHook(
        (e) => hook.process(e),
        event
      );
      
      // Then: Should succeed with execution metadata (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.metadata?.executionTime).toBeGreaterThan(0);
    });

    it('should handle environment timeouts', async () => {
      // Given: Environment with short timeout
      const shortTimeoutEnv = new MockHookEnvironment({ timeout: 100 });
      const event = eventGenerator.createUserPromptSubmitEvent('Timeout test');
      
      // When: Executing with artificial delay
      const slowHook = async (e: any) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return hook.process(e);
      };
      
      // Then: Should timeout (this will fail initially)
      await expect(shortTimeoutEnv.executeHook(slowHook, event))
        .rejects.toThrow('timed out');
      
      shortTimeoutEnv.reset();
    });

    it('should handle environment failures', async () => {
      // Given: Environment with failure simulation
      const failingEnv = new MockHookEnvironment({ failureRate: 1.0 });
      const event = eventGenerator.createUserPromptSubmitEvent('Failure test');
      
      // When: Executing in failing environment
      // Then: Should throw simulated failure (this will fail initially)
      await expect(failingEnv.executeHook((e) => hook.process(e), event))
        .rejects.toThrow('Simulated failure');
      
      failingEnv.reset();
    });
  });

  describe('performance and load testing', () => {
    it('should process multiple events efficiently', async () => {
      // Given: Multiple events
      const events = Array.from({ length: 10 }, (_, i) => 
        eventGenerator.createUserPromptSubmitEvent(`Prompt ${i + 1}`)
      );
      
      // When: Processing all events
      const startTime = Date.now();
      const responses = await Promise.all(
        events.map(event => hook.process(event))
      );
      const duration = Date.now() - startTime;
      
      // Then: Should process efficiently (this will fail initially)
      expect(responses).toHaveLength(10);
      expect(responses.every(r => r.success)).toBe(true);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle concurrent processing', async () => {
      // Given: Concurrent events
      const concurrentCount = 5;
      const events = Array.from({ length: concurrentCount }, (_, i) => 
        eventGenerator.createUserPromptSubmitEvent(`Concurrent prompt ${i + 1}`)
      );
      
      // When: Processing concurrently
      const responses = await Promise.all(
        events.map(event => hook.process(event))
      );
      
      // Then: Should handle concurrency correctly (this will fail initially)
      expect(responses).toHaveLength(concurrentCount);
      expect(responses.every(r => r.success)).toBe(true);
      expect(new Set(responses.map(r => r.metadata?.hookId))).toHaveSize(1);
    });

    it('should maintain performance with large prompts', async () => {
      // Given: Large but valid prompt
      const largePrompt = 'x'.repeat(50000); // 50KB prompt
      const event = eventGenerator.createUserPromptSubmitEvent(largePrompt);
      
      // When: Processing large prompt
      const startTime = Date.now();
      const response = await hook.process(event);
      const duration = Date.now() - startTime;
      
      // Then: Should maintain performance (this will fail initially)
      expect(response.success).toBe(true);
      expect(duration).toBeLessThan(500); // Should complete within 500ms
    });
  });

  describe('edge cases and boundary conditions', () => {
    it('should handle Unicode and special characters', async () => {
      // Given: Prompt with Unicode characters
      const unicodePrompt = '🚀 How do I implement 日本語 support with émojis and ñoñó characters?';
      const event = eventGenerator.createUserPromptSubmitEvent(unicodePrompt);
      
      // When: Processing Unicode prompt
      const response = await hook.process(event);
      
      // Then: Should handle Unicode correctly (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.content).toBe(unicodePrompt);
    });

    it('should handle prompts with only code blocks', async () => {
      // Given: Prompt that is only code
      const codeOnlyPrompt = `
        \`\`\`typescript
        interface User {
          id: string;
          name: string;
        }
        \`\`\`
      `;
      const event = eventGenerator.createUserPromptSubmitEvent(codeOnlyPrompt);
      
      // When: Processing code-only prompt
      const response = await hook.process(event);
      
      // Then: Should process correctly (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.hasCode).toBe(true);
    });

    it('should handle malformed code blocks gracefully', async () => {
      // Given: Prompt with malformed code blocks
      const malformedPrompt = 'Check this: ```typescript\nconst x = 42;\n``` and this ```\nno language\n';
      const event = eventGenerator.createUserPromptSubmitEvent(malformedPrompt);
      
      // When: Processing malformed code blocks
      const response = await hook.process(event);
      
      // Then: Should handle gracefully (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.content).toBe(malformedPrompt);
    });

    it('should handle extremely nested metadata', async () => {
      // Given: Event with deeply nested metadata
      const deepMetadata = {
        source: 'file' as const,
        deep: {
          level1: {
            level2: {
              level3: {
                apiKey: 'secret-key',
                value: 'deep-value',
              },
            },
          },
        },
      };
      const event = eventGenerator.createUserPromptSubmitEvent('Deep test', deepMetadata as any);
      
      // When: Processing deeply nested metadata
      const response = await hook.process(event);
      
      // Then: Should handle deep nesting and sanitize appropriately (this will fail initially)
      expect(response.success).toBe(true);
      expect((response.data?.metadata as any)?.deep?.level1?.level2?.level3?.apiKey).toBe('[REDACTED]');
      expect((response.data?.metadata as any)?.deep?.level1?.level2?.level3?.value).toBe('deep-value');
    });
  });
});