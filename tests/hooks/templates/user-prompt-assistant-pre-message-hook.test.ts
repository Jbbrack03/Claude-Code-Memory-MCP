/**
 * Comprehensive failing tests for UserPromptAssistantPreMessageHook
 * Following TDD red phase - these tests will fail initially
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { UserPromptAssistantPreMessageHook, createUserPromptAssistantPreMessageHook } from '../../../src/hooks/templates/user-prompt-assistant-pre-message-hook.js';
import { HookEventGenerator } from '../mock/hook-event-generator.js';
import { MockHookEnvironment } from '../mock/mock-hook-environment.js';
import { setupTestTimeouts, setupTestCleanup } from '../../utils/test-helpers.js';

describe('UserPromptAssistantPreMessageHook', () => {
  let hook: UserPromptAssistantPreMessageHook;
  let eventGenerator: HookEventGenerator;
  let mockEnvironment: MockHookEnvironment;

  setupTestTimeouts(10000);
  setupTestCleanup();

  beforeEach(() => {
    hook = new UserPromptAssistantPreMessageHook();
    eventGenerator = new HookEventGenerator();
    mockEnvironment = new MockHookEnvironment();
  });

  afterEach(() => {
    eventGenerator.reset();
    mockEnvironment.reset();
  });

  describe('constructor', () => {
    it('should initialize with correct hook configuration', () => {
      // Given: UserPromptAssistantPreMessageHook constructor
      // When: Creating new instance
      const newHook = new UserPromptAssistantPreMessageHook();
      
      // Then: Should have correct configuration (this will fail initially)
      expect((newHook as any).hookId).toBe('user-prompt-assistant-pre-message-hook');
      expect((newHook as any).timeout).toBe(2000);
      expect((newHook as any).maxRetries).toBe(1);
    });

    it('should be creatable via factory function', () => {
      // Given: Factory function
      // When: Creating hook via factory
      const factoryHook = createUserPromptAssistantPreMessageHook();
      
      // Then: Should create instance with correct type (this will fail initially)
      expect(factoryHook).toBeInstanceOf(UserPromptAssistantPreMessageHook);
      expect((factoryHook as any).hookId).toBe('user-prompt-assistant-pre-message-hook');
    });
  });

  describe('process method - basic functionality', () => {
    it('should process valid pre-message events with context requested', async () => {
      // Given: Valid pre-message event
      const event = eventGenerator.createAssistantPreMessageEvent(
        'How do I implement authentication?',
        { contextRequested: true, maxContextTokens: 2000 }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should return success response with context injection (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.inject).toBe(true);
      expect(response.data?.context).toBeDefined();
      expect(response.data?.context?.maxTokens).toBe(2000);
      expect(response.data?.context?.relevantMemories).toBeDefined();
      expect(response.data?.context?.searchQueries).toBeDefined();
    });

    it('should skip context injection when not requested', async () => {
      // Given: Event with context not requested
      const event = eventGenerator.createAssistantPreMessageEvent(
        'Simple question',
        { contextRequested: false }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should skip injection (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.inject).toBe(false);
      expect(response.data?.reason).toBe('Context not requested for this prompt');
    });

    it('should default to context requested when not specified', async () => {
      // Given: Event without contextRequested field
      const event = eventGenerator.createAssistantPreMessageEvent('Default behavior test');
      // Remove contextRequested to test default behavior
      delete (event.data as any).contextRequested;
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should default to requesting context (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.inject).toBe(true);
    });

    it('should include metadata with prompt and context info', async () => {
      // Given: Event with specific prompt ID
      const promptId = 'test-prompt-123';
      const event = eventGenerator.createAssistantPreMessageEvent(
        'Test prompt',
        { promptId, contextRequested: true }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should include prompt metadata (this will fail initially)
      expect(response.data?.metadata?.promptId).toBe(promptId);
      expect(response.data?.metadata?.contextType).toBeDefined();
      expect(response.data?.metadata?.estimatedRelevance).toBeDefined();
    });
  });

  describe('context needs analysis', () => {
    it('should detect references to previous work', async () => {
      // Given: Prompt referencing previous conversation
      const event = eventGenerator.createAssistantPreMessageEvent(
        'Based on what we discussed earlier, how do I implement the previous solution?'
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should prioritize conversation history (this will fail initially)
      expect(response.data?.context?.relevantMemories).toContain('conversation_history');
      expect(response.data?.context?.priority).toBe('high');
      expect(response.data?.metadata?.estimatedRelevance).toBeGreaterThan(0.7);
    });

    it('should detect file references and extract search queries', async () => {
      // Given: Prompt with file references
      const event = eventGenerator.createAssistantPreMessageEvent(
        'Please check the ./src/components/Button.tsx and ../utils/helper.js files'
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should detect file context (this will fail initially)
      expect(response.data?.context?.relevantMemories).toContain('file_operations');
      expect(response.data?.context?.searchQueries).toContain('./src/components/Button.tsx');
      expect(response.data?.context?.searchQueries).toContain('../utils/helper.js');
      expect(response.data?.metadata?.contextType).toBe('file_context');
      expect(response.data?.metadata?.estimatedRelevance).toBeGreaterThan(0.8);
    });

    it('should detect code-related queries', async () => {
      // Given: Code-focused prompt
      const event = eventGenerator.createAssistantPreMessageEvent(
        'How do I refactor this function to use a better class structure with proper methods?'
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should detect code context (this will fail initially)
      expect(response.data?.context?.relevantMemories).toContain('code_analysis');
      expect(response.data?.metadata?.contextType).toBe('code_context');
      expect(response.data?.metadata?.estimatedRelevance).toBeGreaterThan(0.8);
    });

    it('should detect error and debugging queries', async () => {
      // Given: Error-focused prompt
      const event = eventGenerator.createAssistantPreMessageEvent(
        'I\'m getting an error when trying to debug this bug. How do I fix it?'
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should prioritize debugging context (this will fail initially)
      expect(response.data?.context?.relevantMemories).toContain('error_diagnostics');
      expect(response.data?.metadata?.contextType).toBe('debugging_context');
      expect(response.data?.context?.priority).toBe('high');
      expect(response.data?.metadata?.estimatedRelevance).toBeGreaterThan(0.8);
    });

    it('should detect configuration and setup queries', async () => {
      // Given: Configuration-focused prompt
      const event = eventGenerator.createAssistantPreMessageEvent(
        'How do I configure the environment and setup the installation process?'
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should detect setup context (this will fail initially)
      expect(response.data?.context?.relevantMemories).toContain('configuration');
      expect(response.data?.metadata?.contextType).toBe('setup_context');
      expect(response.data?.metadata?.estimatedRelevance).toBeGreaterThan(0.7);
    });

    it('should default to recent memories for general queries', async () => {
      // Given: General prompt without specific indicators
      const event = eventGenerator.createAssistantPreMessageEvent(
        'This is a general question about programming best practices.'
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should default to recent memories (this will fail initially)
      expect(response.data?.context?.relevantMemories).toContain('recent_memories');
      expect(response.data?.context?.priority).toBe('low');
      expect(response.data?.metadata?.estimatedRelevance).toBeLessThan(0.5);
    });
  });

  describe('keyword extraction', () => {
    it('should extract meaningful keywords from prompts', async () => {
      // Given: Prompt with specific technical terms
      const event = eventGenerator.createAssistantPreMessageEvent(
        'How do I implement authentication with TypeScript using JWT tokens and bcrypt hashing?'
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should extract relevant keywords (this will fail initially)
      const searchQueries = response.data?.context?.searchQueries || [];
      expect(searchQueries).toContain('authentication');
      expect(searchQueries).toContain('typescript');
      expect(searchQueries).toContain('tokens');
      expect(searchQueries).toContain('bcrypt');
      expect(searchQueries).toContain('hashing');
    });

    it('should filter out stop words', async () => {
      // Given: Prompt with many stop words
      const event = eventGenerator.createAssistantPreMessageEvent(
        'How do I implement the best practices for a secure authentication system?'
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should exclude stop words (this will fail initially)
      const searchQueries = response.data?.context?.searchQueries || [];
      expect(searchQueries).not.toContain('how');
      expect(searchQueries).not.toContain('the');
      expect(searchQueries).not.toContain('for');
      expect(searchQueries).toContain('implement');
      expect(searchQueries).toContain('practices');
      expect(searchQueries).toContain('secure');
    });

    it('should limit keywords to top 5 by length', async () => {
      // Given: Prompt with many potential keywords
      const event = eventGenerator.createAssistantPreMessageEvent(
        'authentication authorization implementation configuration documentation optimization performance'
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should limit to 5 keywords, prioritizing longer ones (this will fail initially)
      const searchQueries = response.data?.context?.searchQueries || [];
      expect(searchQueries).toHaveLength(5);
      expect(searchQueries).toContain('authentication');
      expect(searchQueries).toContain('authorization');
      expect(searchQueries).toContain('implementation');
      expect(searchQueries).toContain('configuration');
      expect(searchQueries).toContain('documentation');
    });

    it('should handle empty or short prompts gracefully', async () => {
      // Given: Very short prompt
      const event = eventGenerator.createAssistantPreMessageEvent('Hi');
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should handle gracefully with minimal keywords (this will fail initially)
      expect(response.success).toBe(true);
      const searchQueries = response.data?.context?.searchQueries || [];
      expect(searchQueries).toHaveLength(0); // No meaningful keywords from "Hi"
    });
  });

  describe('conversation history analysis', () => {
    it('should analyze conversation history for context continuity', async () => {
      // Given: Event with conversation history containing TODOs
      const history = [
        {
          role: 'user' as const,
          content: 'How do I implement authentication?',
          timestamp: new Date().toISOString(),
        },
        {
          role: 'assistant' as const,
          content: 'Here\'s how to implement authentication. TODO: Add error handling to the login function.',
          timestamp: new Date().toISOString(),
        },
      ];
      
      const event = eventGenerator.createAssistantPreMessageEvent(
        'What about the error handling?',
        { conversationHistory: history }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should detect task tracking needs (this will fail initially)
      expect(response.data?.context?.relevantMemories).toContain('task_tracking');
      expect(response.data?.context?.priority).toBe('high');
    });

    it('should limit conversation history analysis to recent messages', async () => {
      // Given: Event with long conversation history
      const longHistory = Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message ${i + 1}`,
        timestamp: new Date(Date.now() - (10 - i) * 60000).toISOString(),
      }));
      
      const event = eventGenerator.createAssistantPreMessageEvent(
        'Continue the conversation',
        { conversationHistory: longHistory }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should analyze only recent messages (this will fail initially)
      expect(response.success).toBe(true);
      // The analysis should focus on the last 5 messages
    });

    it('should handle empty conversation history', async () => {
      // Given: Event with empty conversation history
      const event = eventGenerator.createAssistantPreMessageEvent(
        'First message',
        { conversationHistory: [] }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should handle gracefully (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.inject).toBe(true);
    });
  });

  describe('context token limits', () => {
    it('should respect custom max context tokens', async () => {
      // Given: Event with custom token limit
      const customTokenLimit = 5000;
      const event = eventGenerator.createAssistantPreMessageEvent(
        'Test with custom token limit',
        { maxContextTokens: customTokenLimit }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should use custom token limit (this will fail initially)
      expect(response.data?.context?.maxTokens).toBe(customTokenLimit);
    });

    it('should default to 2000 tokens when not specified', async () => {
      // Given: Event without token limit specified
      const event = eventGenerator.createAssistantPreMessageEvent('Default token test');
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should use default token limit (this will fail initially)
      expect(response.data?.context?.maxTokens).toBe(2000);
    });

    it('should handle zero or negative token limits', async () => {
      // Given: Event with invalid token limit
      const event = eventGenerator.createAssistantPreMessageEvent(
        'Invalid token limit test',
        { maxContextTokens: -100 }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should handle gracefully, possibly using default (this will fail initially)
      expect(response.success).toBe(true);
      expect(typeof response.data?.context?.maxTokens).toBe('number');
    });
  });

  describe('event validation', () => {
    it('should reject events with invalid schema', async () => {
      // Given: Event with missing required fields
      const invalidEvent = eventGenerator.createAssistantPreMessageEvent('test');
      delete (invalidEvent.data as any).promptId;
      delete (invalidEvent.data as any).userPrompt;
      
      // When: Processing invalid event
      const response = await hook.process(invalidEvent);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('PRE_MESSAGE_HOOK_ERROR');
    });

    it('should handle malformed conversation history', async () => {
      // Given: Event with malformed conversation history
      const event = eventGenerator.createAssistantPreMessageEvent('test');
      (event.data as any).conversationHistory = 'invalid-history'; // Should be array
      
      // When: Processing event
      const response = await hook.process(event);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('PRE_MESSAGE_HOOK_ERROR');
    });

    it('should validate conversation history message format', async () => {
      // Given: Event with invalid message format in history
      const invalidHistory = [
        {
          role: 'invalid-role', // Should be 'user' or 'assistant'
          content: 'test message',
          timestamp: new Date().toISOString(),
        },
      ];
      
      const event = eventGenerator.createAssistantPreMessageEvent(
        'test',
        { conversationHistory: invalidHistory as any }
      );
      
      // When: Processing event
      const response = await hook.process(event);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('PRE_MESSAGE_HOOK_ERROR');
    });
  });

  describe('error handling', () => {
    it('should handle analysis errors gracefully', async () => {
      // Given: Hook that will throw during context analysis
      const originalAnalyzeContextNeeds = hook['analyzeContextNeeds'];
      hook['analyzeContextNeeds'] = () => { throw new Error('Analysis failed'); };
      
      const event = eventGenerator.createAssistantPreMessageEvent('test');
      
      try {
        // When: Processing with error
        const response = await hook.process(event);
        
        // Then: Should return error response (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.code).toBe('PRE_MESSAGE_HOOK_ERROR');
        expect(response.error?.message).toBe('Analysis failed');
      } finally {
        hook['analyzeContextNeeds'] = originalAnalyzeContextNeeds;
      }
    });

    it('should handle keyword extraction errors', async () => {
      // Given: Hook that will throw during keyword extraction
      const originalExtractKeywords = hook['extractKeywords'];
      hook['extractKeywords'] = () => { throw new Error('Keyword extraction failed'); };
      
      const event = eventGenerator.createAssistantPreMessageEvent('test');
      
      try {
        // When: Processing with error
        const response = await hook.process(event);
        
        // Then: Should return error response (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.code).toBe('PRE_MESSAGE_HOOK_ERROR');
      } finally {
        hook['extractKeywords'] = originalExtractKeywords;
      }
    });

    it('should include error stack in details for debugging', async () => {
      // Given: Hook that will throw with stack trace
      const originalValidateEvent = hook['validateEvent'];
      hook['validateEvent'] = () => { 
        const error = new Error('Validation failed');
        error.stack = 'Error stack trace here';
        throw error;
      };
      
      const event = eventGenerator.createAssistantPreMessageEvent('test');
      
      try {
        // When: Processing with error
        const response = await hook.process(event);
        
        // Then: Should include stack trace (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.details?.error).toBe('Error stack trace here');
      } finally {
        hook['validateEvent'] = originalValidateEvent;
      }
    });
  });

  describe('performance and timing', () => {
    it('should complete within timeout limits', async () => {
      // Given: Event for timing test
      const event = eventGenerator.createAssistantPreMessageEvent('Performance test prompt');
      
      // When: Processing with timing
      const startTime = Date.now();
      const response = await hook.process(event);
      const duration = Date.now() - startTime;
      
      // Then: Should complete quickly (this will fail initially)
      expect(response.success).toBe(true);
      expect(duration).toBeLessThan(2000); // Should be under timeout limit
    });

    it('should handle concurrent processing efficiently', async () => {
      // Given: Multiple concurrent events
      const events = Array.from({ length: 5 }, (_, i) => 
        eventGenerator.createAssistantPreMessageEvent(`Concurrent prompt ${i + 1}`)
      );
      
      // When: Processing concurrently
      const startTime = Date.now();
      const responses = await Promise.all(
        events.map(event => hook.process(event))
      );
      const duration = Date.now() - startTime;
      
      // Then: Should handle concurrency efficiently (this will fail initially)
      expect(responses).toHaveLength(5);
      expect(responses.every(r => r.success)).toBe(true);
      expect(duration).toBeLessThan(3000); // Reasonable time for concurrent processing
    });

    it('should maintain performance with complex prompts', async () => {
      // Given: Complex prompt with multiple analysis triggers
      const complexPrompt = `
        Based on our previous discussion about authentication, 
        I need to debug an error in ./src/auth/login.ts where the 
        JWT token generation function throws an exception. 
        The configuration file needs to be updated to install 
        proper bcrypt hashing. How do I fix this?
      `;
      
      const event = eventGenerator.createAssistantPreMessageEvent(complexPrompt);
      
      // When: Processing complex prompt
      const startTime = Date.now();
      const response = await hook.process(event);
      const duration = Date.now() - startTime;
      
      // Then: Should maintain performance (this will fail initially)
      expect(response.success).toBe(true);
      expect(duration).toBeLessThan(1000); // Should still be fast
      expect(response.data?.context?.relevantMemories?.length).toBeGreaterThan(1);
    });
  });

  describe('integration with mock environment', () => {
    it('should execute successfully in mock environment', async () => {
      // Given: Hook and mock environment
      const event = eventGenerator.createAssistantPreMessageEvent('Environment test');
      
      // When: Executing in mock environment
      const response = await mockEnvironment.executeHook(
        (e) => hook.process(e),
        event
      );
      
      // Then: Should succeed with execution metadata (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.metadata?.executionTime).toBeGreaterThan(0);
    });

    it('should respect environment timeout constraints', async () => {
      // Given: Environment with very short timeout
      const quickEnv = new MockHookEnvironment({ timeout: 500 });
      const event = eventGenerator.createAssistantPreMessageEvent('Quick test');
      
      // When: Executing with tight timeout
      const response = await quickEnv.executeHook(
        (e) => hook.process(e),
        event
      );
      
      // Then: Should complete within timeout (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.metadata?.executionTime).toBeLessThan(500);
      
      quickEnv.reset();
    });
  });

  describe('edge cases', () => {
    it('should handle prompts with only special characters', async () => {
      // Given: Prompt with only special characters
      const specialPrompt = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const event = eventGenerator.createAssistantPreMessageEvent(specialPrompt);
      
      // When: Processing special character prompt
      const response = await hook.process(event);
      
      // Then: Should handle gracefully (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.inject).toBe(true);
    });

    it('should handle extremely long prompts', async () => {
      // Given: Very long prompt
      const longPrompt = 'authentication '.repeat(1000);
      const event = eventGenerator.createAssistantPreMessageEvent(longPrompt);
      
      // When: Processing long prompt
      const response = await hook.process(event);
      
      // Then: Should handle and extract relevant context (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.context?.searchQueries).toContain('authentication');
    });

    it('should handle Unicode and international characters', async () => {
      // Given: Prompt with Unicode characters
      const unicodePrompt = '如何实现身份验证？Comment configurer l\'authentification? Как реализовать аутентификацию?';
      const event = eventGenerator.createAssistantPreMessageEvent(unicodePrompt);
      
      // When: Processing Unicode prompt
      const response = await hook.process(event);
      
      // Then: Should handle Unicode correctly (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.inject).toBe(true);
    });

    it('should handle null or undefined prompt gracefully', async () => {
      // Given: Event with null prompt
      const event = eventGenerator.createAssistantPreMessageEvent('test');
      (event.data as any).userPrompt = null;
      
      // When: Processing null prompt
      const response = await hook.process(event);
      
      // Then: Should handle gracefully with error (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('PRE_MESSAGE_HOOK_ERROR');
    });
  });
});