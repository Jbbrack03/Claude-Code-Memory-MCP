/**
 * Comprehensive failing tests for UserPromptAssistantPostMessageHook
 * Following TDD red phase - these tests will fail initially
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { UserPromptAssistantPostMessageHook, createUserPromptAssistantPostMessageHook } from '../../../src/hooks/templates/user-prompt-assistant-post-message-hook.js';
import { HookEventGenerator } from '../mock/hook-event-generator.js';
import { MockHookEnvironment } from '../mock/mock-hook-environment.js';
import { setupTestTimeouts, setupTestCleanup } from '../../utils/test-helpers.js';

describe('UserPromptAssistantPostMessageHook', () => {
  let hook: UserPromptAssistantPostMessageHook;
  let eventGenerator: HookEventGenerator;
  let mockEnvironment: MockHookEnvironment;

  setupTestTimeouts(10000);
  setupTestCleanup();

  beforeEach(() => {
    hook = new UserPromptAssistantPostMessageHook();
    eventGenerator = new HookEventGenerator();
    mockEnvironment = new MockHookEnvironment();
  });

  afterEach(() => {
    eventGenerator.reset();
    mockEnvironment.reset();
  });

  describe('constructor', () => {
    it('should initialize with correct hook configuration', () => {
      // Given: UserPromptAssistantPostMessageHook constructor
      // When: Creating new instance
      const newHook = new UserPromptAssistantPostMessageHook();
      
      // Then: Should have correct configuration (this will fail initially)
      expect((newHook as any).hookId).toBe('user-prompt-assistant-post-message-hook');
      expect((newHook as any).timeout).toBe(5000);
      expect((newHook as any).maxRetries).toBe(2);
    });

    it('should be creatable via factory function', () => {
      // Given: Factory function
      // When: Creating hook via factory
      const factoryHook = createUserPromptAssistantPostMessageHook();
      
      // Then: Should create instance with correct type (this will fail initially)
      expect(factoryHook).toBeInstanceOf(UserPromptAssistantPostMessageHook);
      expect((factoryHook as any).hookId).toBe('user-prompt-assistant-post-message-hook');
    });
  });

  describe('process method - basic functionality', () => {
    it('should process valid post-message events', async () => {
      // Given: Valid post-message event
      const userPrompt = 'How do I implement authentication?';
      const assistantResponse = 'Here\'s how to implement JWT authentication with proper error handling...';
      const event = eventGenerator.createAssistantPostMessageEvent(userPrompt, assistantResponse, {
        outcome: { success: true, errorCount: 0, warningCount: 0 }
      });
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should return success response with memory entry (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.store).toBe(true);
      expect(response.data?.memoryEntry).toBeDefined();
      expect(response.data?.memoryEntry?.type).toBe('conversation');
      expect(response.data?.memoryEntry?.content?.userPrompt).toBe(userPrompt);
      expect(response.data?.memoryEntry?.content?.assistantResponse).toBe(assistantResponse);
    });

    it('should include comprehensive metadata in memory entry', async () => {
      // Given: Event with detailed metadata
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Test prompt',
        'Test response',
        {
          messageId: 'msg-123',
          promptId: 'prompt-456',
          conversationId: 'conv-789',
          metadata: {
            model: 'claude-3-sonnet',
            tokensUsed: 150,
            executionTime: 2500,
            toolsUsed: ['Read', 'Write'],
            filesModified: ['test.ts', 'config.json']
          },
          outcome: { success: true, errorCount: 0, warningCount: 1 }
        }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should include all metadata (this will fail initially)
      const memoryEntry = response.data?.memoryEntry;
      expect(memoryEntry?.conversation?.messageId).toBe('msg-123');
      expect(memoryEntry?.conversation?.promptId).toBe('prompt-456');
      expect(memoryEntry?.conversation?.conversationId).toBe('conv-789');
      expect(memoryEntry?.metadata?.model).toBe('claude-3-sonnet');
      expect(memoryEntry?.metadata?.tokensUsed).toBe(150);
      expect(memoryEntry?.metadata?.executionTime).toBe(2500);
      expect(memoryEntry?.metadata?.outcome?.warningCount).toBe(1);
    });

    it('should generate unique memory IDs', async () => {
      // Given: Multiple events with same content but different IDs
      const events = Array.from({ length: 3 }, (_, i) => 
        eventGenerator.createAssistantPostMessageEvent(
          'Same prompt',
          'Same response',
          { messageId: `msg-${i}`, promptId: `prompt-${i}` }
        )
      );
      
      // When: Processing all events
      const responses = await Promise.all(
        events.map(event => hook.process(event))
      );
      
      // Then: Should generate unique memory IDs (this will fail initially)
      const memoryIds = responses.map(r => r.data?.memoryEntry?.id);
      expect(new Set(memoryIds)).toHaveSize(3);
      expect(memoryIds.every(id => typeof id === 'string' && id.length === 16)).toBe(true);
    });

    it('should include workspace and session context', async () => {
      // Given: Event with context
      const event = eventGenerator.createAssistantPostMessageEvent('Context test', 'Response');
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should include context in memory entry (this will fail initially)
      const memoryEntry = response.data?.memoryEntry;
      expect(memoryEntry?.workspace).toBe('/test/workspace');
      expect(memoryEntry?.session).toMatch(/^test-session-/);
    });
  });

  describe('tag extraction', () => {
    it('should extract programming language tags', async () => {
      // Given: Conversation about multiple programming languages
      const userPrompt = 'How do I use TypeScript with React?';
      const assistantResponse = 'Here\'s how to set up TypeScript with React and JavaScript...';
      const event = eventGenerator.createAssistantPostMessageEvent(userPrompt, assistantResponse);
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should extract language tags (this will fail initially)
      const tags = response.data?.memoryEntry?.tags;
      expect(tags).toContain('typescript');
      expect(tags).toContain('react');
      expect(tags).toContain('javascript');
    });

    it('should extract framework and library tags', async () => {
      // Given: Conversation about frameworks
      const userPrompt = 'Which framework should I use?';
      const assistantResponse = 'You could use React, Vue, Angular, Express, or Django depending on your needs...';
      const event = eventGenerator.createAssistantPostMessageEvent(userPrompt, assistantResponse);
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should extract framework tags (this will fail initially)
      const tags = response.data?.memoryEntry?.tags;
      expect(tags).toContain('react');
      expect(tags).toContain('vue');
      expect(tags).toContain('angular');
      expect(tags).toContain('express');
      expect(tags).toContain('django');
    });

    it('should extract task type tags', async () => {
      // Given: Different types of tasks
      const testCases = [
        { prompt: 'Help me debug this error', response: 'Here\'s how to fix the bug...', expectedTag: 'debugging' },
        { prompt: 'How do I implement this?', response: 'Let\'s create and build this feature...', expectedTag: 'implementation' },
        { prompt: 'Can you refactor this code?', response: 'Here\'s how to improve and optimize it...', expectedTag: 'refactoring' },
        { prompt: 'I need tests for this', response: 'Here are some Jest test specs...', expectedTag: 'testing' },
        { prompt: 'Document this function', response: 'Here\'s the documentation and comments...', expectedTag: 'documentation' }
      ];
      
      // When: Processing different task types
      const responses = await Promise.all(
        testCases.map(testCase => {
          const event = eventGenerator.createAssistantPostMessageEvent(testCase.prompt, testCase.response);
          return hook.process(event);
        })
      );
      
      // Then: Should extract correct task tags (this will fail initially)
      responses.forEach((response, index) => {
        const tags = response.data?.memoryEntry?.tags;
        expect(tags).toContain(testCases[index].expectedTag);
      });
    });

    it('should handle conversations without identifiable tags', async () => {
      // Given: Generic conversation
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Hello there',
        'Hi! How can I help you today?'
      );
      
      // When: Processing generic conversation
      const response = await hook.process(event);
      
      // Then: Should handle gracefully with minimal tags (this will fail initially)
      const tags = response.data?.memoryEntry?.tags;
      expect(Array.isArray(tags)).toBe(true);
      expect(tags?.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('summary generation', () => {
    it('should generate concise summaries from conversations', async () => {
      // Given: Conversation with clear action
      const userPrompt = 'How do I create a React component with TypeScript? I need it to handle user authentication.';
      const assistantResponse = 'I\'ll help you create a TypeScript React component for authentication...';
      const event = eventGenerator.createAssistantPostMessageEvent(userPrompt, assistantResponse);
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should generate meaningful summary (this will fail initially)
      const summary = response.data?.memoryEntry?.content?.summary;
      expect(typeof summary).toBe('string');
      expect(summary?.length).toBeLessThanOrEqual(200);
      expect(summary).toContain('React component');
    });

    it('should identify main actions in responses', async () => {
      // Given: Different action types
      const actionTests = [
        { response: 'I created the Button component for you...', expectedAction: 'Created implementation' },
        { response: 'I fixed the authentication bug...', expectedAction: 'Fixed issue' },
        { response: 'Let me explain how React hooks work...', expectedAction: 'Provided explanation' },
        { response: 'I analyzed your code structure...', expectedAction: 'Performed analysis' },
        { response: 'I suggest using TypeScript...', expectedAction: 'Provided recommendations' }
      ];
      
      // When: Processing different action types
      const responses = await Promise.all(
        actionTests.map(test => {
          const event = eventGenerator.createAssistantPostMessageEvent('Test prompt', test.response);
          return hook.process(event);
        })
      );
      
      // Then: Should identify correct actions (this will fail initially)
      responses.forEach((response, index) => {
        const summary = response.data?.memoryEntry?.content?.summary;
        expect(summary).toContain(actionTests[index].expectedAction);
      });
    });

    it('should limit summary length appropriately', async () => {
      // Given: Very long conversation
      const longPrompt = 'This is a very long prompt that goes on and on about implementation details...'.repeat(10);
      const longResponse = 'Here is a very detailed response with lots of information...'.repeat(20);
      const event = eventGenerator.createAssistantPostMessageEvent(longPrompt, longResponse);
      
      // When: Processing long conversation
      const response = await hook.process(event);
      
      // Then: Should limit summary length (this will fail initially)
      const summary = response.data?.memoryEntry?.content?.summary;
      expect(summary?.length).toBeLessThanOrEqual(200);
    });
  });

  describe('artifact extraction', () => {
    it('should extract tools used from metadata', async () => {
      // Given: Event with tools used
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Use tools to help me',
        'I used several tools to assist you',
        {
          metadata: {
            toolsUsed: ['Read', 'Write', 'Bash', 'Edit']
          }
        }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should extract tools (this will fail initially)
      const artifacts = response.data?.memoryEntry?.artifacts;
      expect(artifacts?.tools).toEqual(['Read', 'Write', 'Bash', 'Edit']);
    });

    it('should extract files modified from metadata', async () => {
      // Given: Event with file modifications
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Modify these files',
        'I modified the files as requested',
        {
          metadata: {
            filesModified: ['src/Button.tsx', 'tests/Button.test.ts', 'package.json']
          }
        }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should extract files (this will fail initially)
      const artifacts = response.data?.memoryEntry?.artifacts;
      expect(artifacts?.files).toEqual(['src/Button.tsx', 'tests/Button.test.ts', 'package.json']);
    });

    it('should extract code blocks from assistant responses', async () => {
      // Given: Response with multiple code blocks
      const responseWithCode = `
        Here's the TypeScript implementation:
        \`\`\`typescript
        interface User {
          id: string;
          name: string;
        }
        \`\`\`
        
        And here's a JavaScript example:
        \`\`\`javascript
        const user = { id: '1', name: 'John' };
        \`\`\`
        
        And some JSON config:
        \`\`\`json
        { "version": "1.0.0" }
        \`\`\`
      `;
      
      const event = eventGenerator.createAssistantPostMessageEvent('Show me code', responseWithCode);
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should extract code blocks (this will fail initially)
      const artifacts = response.data?.memoryEntry?.artifacts;
      expect(artifacts?.codeBlocks).toHaveLength(3);
      expect(artifacts?.codeBlocks?.[0]?.language).toBe('typescript');
      expect(artifacts?.codeBlocks?.[1]?.language).toBe('javascript');
      expect(artifacts?.codeBlocks?.[2]?.language).toBe('json');
    });

    it('should handle responses without artifacts', async () => {
      // Given: Simple conversation without artifacts
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Simple question',
        'Simple answer without any tools or code'
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should handle gracefully (this will fail initially)
      const artifacts = response.data?.memoryEntry?.artifacts;
      expect(typeof artifacts).toBe('object');
      expect(Object.keys(artifacts || {})).toHaveLength(0);
    });
  });

  describe('searchable text creation', () => {
    it('should create comprehensive searchable text', async () => {
      // Given: Rich conversation content
      const userPrompt = 'How do I implement authentication with JWT tokens?';
      const assistantResponse = `
        Here's how to implement JWT authentication:
        1. Install the jsonwebtoken package
        2. Create a login endpoint  
        3. Generate tokens on successful login
        
        \`\`\`typescript
        const token = jwt.sign(payload, secret);
        \`\`\`
        
        This approach ensures secure authentication.
      `;
      
      const event = eventGenerator.createAssistantPostMessageEvent(userPrompt, assistantResponse);
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should create comprehensive searchable text (this will fail initially)
      const searchableText = response.data?.memoryEntry?.searchableText;
      expect(typeof searchableText).toBe('string');
      expect(searchableText).toContain('authentication');
      expect(searchableText).toContain('JWT');
      expect(searchableText?.length).toBeLessThanOrEqual(1000);
      // Should not contain code blocks
      expect(searchableText).not.toContain('```');
    });

    it('should prioritize key sentences from responses', async () => {
      // Given: Response with mix of short and long sentences
      const response = `
        Short sentence. This is a longer sentence with more detailed information about the implementation.
        Another brief one. Here's another comprehensive sentence explaining the authentication process in detail.
        Very short. This final sentence provides extensive information about security considerations.
      `;
      
      const event = eventGenerator.createAssistantPostMessageEvent('Test', response);
      
      // When: Processing the event
      const result = await hook.process(event);
      
      // Then: Should prioritize longer, more informative sentences (this will fail initially)
      const searchableText = result.data?.memoryEntry?.searchableText;
      expect(searchableText).toContain('detailed information');
      expect(searchableText).toContain('authentication process');
      expect(searchableText).toContain('security considerations');
    });

    it('should limit searchable text length', async () => {
      // Given: Very long conversation
      const longResponse = 'This is a very long response. '.repeat(200);
      const event = eventGenerator.createAssistantPostMessageEvent('Long test', longResponse);
      
      // When: Processing long conversation
      const response = await hook.process(event);
      
      // Then: Should limit searchable text length (this will fail initially)
      const searchableText = response.data?.memoryEntry?.searchableText;
      expect(searchableText?.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('conversation quality analysis', () => {
    it('should rate successful conversations highly', async () => {
      // Given: Successful conversation with positive outcome
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Help me implement this feature',
        'I successfully implemented the feature with proper error handling and tests',
        {
          outcome: { success: true, errorCount: 0, warningCount: 0 },
          metadata: { tokensUsed: 200, executionTime: 1500 }
        }
      );
      
      // When: Processing successful conversation
      const response = await hook.process(event);
      
      // Then: Should have high quality score (this will fail initially)
      const qualityScore = response.data?.quality?.score;
      expect(qualityScore).toBeGreaterThan(0.7);
      expect(response.data?.quality?.factors).toContain('high_quality_conversation');
    });

    it('should penalize conversations with errors', async () => {
      // Given: Conversation with errors and warnings
      const event = eventGenerator.createAssistantPostMessageEvent(
        'This failed',
        'There were some issues with the implementation',
        {
          outcome: { success: false, errorCount: 3, warningCount: 2 }
        }
      );
      
      // When: Processing failed conversation
      const response = await hook.process(event);
      
      // Then: Should have lower quality score (this will fail initially)
      const qualityScore = response.data?.quality?.score;
      expect(qualityScore).toBeLessThan(0.5);
      expect(response.data?.quality?.factors).toContain('low_quality_interaction');
    });

    it('should reward comprehensive responses with code', async () => {
      // Given: Comprehensive response with code and explanation
      const comprehensiveResponse = `
        Here's a complete solution:
        \`\`\`typescript
        function authenticate(token: string): boolean {
          return jwt.verify(token, secret);
        }
        \`\`\`
        
        This implementation works because it validates the token signature.
        I also updated the authentication middleware.
      `;
      
      const event = eventGenerator.createAssistantPostMessageEvent(
        'How do I authenticate?',
        comprehensiveResponse,
        {
          outcome: { success: true },
          metadata: { toolsUsed: ['Write', 'Edit'] }
        }
      );
      
      // When: Processing comprehensive response
      const response = await hook.process(event);
      
      // Then: Should have high quality score (this will fail initially)
      const qualityScore = response.data?.quality?.score;
      expect(qualityScore).toBeGreaterThan(0.8);
      expect(response.data?.quality?.factors).toContain('complete_response');
      expect(response.data?.quality?.factors).toContain('actionable_content');
    });

    it('should handle conversations without outcome data', async () => {
      // Given: Conversation without outcome specified
      const event = eventGenerator.createAssistantPostMessageEvent(
        'General question',
        'General answer'
      );
      delete (event.data as any).outcome;
      
      // When: Processing conversation without outcome
      const response = await hook.process(event);
      
      // Then: Should assign reasonable quality score (this will fail initially)
      const qualityScore = response.data?.quality?.score;
      expect(typeof qualityScore).toBe('number');
      expect(qualityScore).toBeGreaterThanOrEqual(0);
      expect(qualityScore).toBeLessThanOrEqual(1);
    });
  });

  describe('storage strategy determination', () => {
    it('should store high-quality conversations with high priority', async () => {
      // Given: High-quality conversation
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Complex implementation question',
        'Comprehensive solution with code, explanations, and file modifications',
        {
          outcome: { success: true, errorCount: 0 },
          metadata: { toolsUsed: ['Write', 'Edit'], filesModified: ['src/auth.ts'] }
        }
      );
      
      // When: Processing high-quality conversation
      const response = await hook.process(event);
      
      // Then: Should store with high priority (this will fail initially)
      expect(response.data?.store).toBe(true);
      expect(response.data?.indexing?.enabled).toBe(true);
      expect(response.data?.indexing?.priority).toBe('high');
      expect(response.data?.indexing?.ttl).toBeUndefined(); // No TTL for high quality
    });

    it('should store medium-quality conversations with TTL', async () => {
      // Given: Medium-quality conversation
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Simple question',
        'Reasonable answer with some useful information',
        {
          outcome: { success: true, warningCount: 1 }
        }
      );
      
      // When: Processing medium-quality conversation
      const response = await hook.process(event);
      
      // Then: Should store with medium priority and TTL (this will fail initially)
      expect(response.data?.store).toBe(true);
      expect(response.data?.indexing?.enabled).toBe(true);
      expect(response.data?.indexing?.priority).toBe('medium');
      expect(response.data?.indexing?.ttl).toBe(30 * 24 * 60 * 60 * 1000); // 30 days
    });

    it('should store low-quality conversations only if they have artifacts', async () => {
      // Given: Low-quality conversation with artifacts
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Quick help',
        'Brief response',
        {
          outcome: { success: false, errorCount: 2 },
          metadata: { toolsUsed: ['Read'] }
        }
      );
      
      // When: Processing low-quality conversation with artifacts
      const response = await hook.process(event);
      
      // Then: Should store without indexing and short TTL (this will fail initially)
      expect(response.data?.store).toBe(true);
      expect(response.data?.indexing?.enabled).toBe(false);
      expect(response.data?.indexing?.priority).toBe('low');
      expect(response.data?.indexing?.ttl).toBe(7 * 24 * 60 * 60 * 1000); // 7 days
    });

    it('should not store very low-quality conversations without artifacts', async () => {
      // Given: Very low-quality conversation without artifacts
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Hi',
        'Hello',
        {
          outcome: { success: false, errorCount: 5 }
        }
      );
      
      // When: Processing very low-quality conversation
      const response = await hook.process(event);
      
      // Then: Should not store (this will fail initially)
      expect(response.data?.store).toBe(false);
      expect(response.data?.memoryEntry).toBeUndefined();
      expect(response.data?.indexing?.enabled).toBe(false);
    });
  });

  describe('cross-reference information', () => {
    it('should include cross-reference IDs for linking', async () => {
      // Given: Event with specific IDs
      const messageId = 'msg-cross-ref';
      const promptId = 'prompt-cross-ref';
      const conversationId = 'conv-cross-ref';
      
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Cross-reference test',
        'Response for cross-referencing',
        { messageId, promptId, conversationId }
      );
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should include cross-reference information (this will fail initially)
      expect(response.data?.crossReference?.messageId).toBe(messageId);
      expect(response.data?.crossReference?.promptId).toBe(promptId);
      expect(response.data?.crossReference?.conversationId).toBe(conversationId);
    });

    it('should handle missing cross-reference IDs gracefully', async () => {
      // Given: Event without some IDs
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Missing IDs test',
        'Response without some IDs'
      );
      delete (event.data as any).conversationId;
      
      // When: Processing the event
      const response = await hook.process(event);
      
      // Then: Should handle gracefully (this will fail initially)
      expect(response.data?.crossReference?.messageId).toBeDefined();
      expect(response.data?.crossReference?.promptId).toBeDefined();
      expect(response.data?.crossReference?.conversationId).toBeUndefined();
    });
  });

  describe('event validation', () => {
    it('should reject events with invalid schema', async () => {
      // Given: Event with missing required fields
      const invalidEvent = eventGenerator.createAssistantPostMessageEvent('test', 'response');
      delete (invalidEvent.data as any).userPrompt;
      delete (invalidEvent.data as any).assistantResponse;
      
      // When: Processing invalid event
      const response = await hook.process(invalidEvent);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('POST_MESSAGE_HOOK_ERROR');
    });

    it('should validate metadata structure', async () => {
      // Given: Event with invalid metadata structure
      const event = eventGenerator.createAssistantPostMessageEvent('test', 'response');
      (event.data as any).metadata = 'invalid-metadata'; // Should be object
      
      // When: Processing invalid event
      const response = await hook.process(event);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('POST_MESSAGE_HOOK_ERROR');
    });

    it('should validate outcome structure', async () => {
      // Given: Event with invalid outcome structure
      const event = eventGenerator.createAssistantPostMessageEvent('test', 'response');
      (event.data as any).outcome = { invalid: true }; // Missing required success field
      
      // When: Processing invalid event
      const response = await hook.process(event);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('POST_MESSAGE_HOOK_ERROR');
    });
  });

  describe('performance and scalability', () => {
    it('should handle large conversations efficiently', async () => {
      // Given: Large conversation data
      const largePrompt = 'Large prompt content. '.repeat(1000);
      const largeResponse = 'Large response content. '.repeat(2000);
      const event = eventGenerator.createAssistantPostMessageEvent(largePrompt, largeResponse);
      
      // When: Processing large conversation
      const startTime = Date.now();
      const response = await hook.process(event);
      const duration = Date.now() - startTime;
      
      // Then: Should handle efficiently (this will fail initially)
      expect(response.success).toBe(true);
      expect(duration).toBeLessThan(3000); // Should complete within 3 seconds
    });

    it('should process multiple conversations concurrently', async () => {
      // Given: Multiple conversation events
      const events = Array.from({ length: 10 }, (_, i) => 
        eventGenerator.createAssistantPostMessageEvent(
          `Prompt ${i + 1}`,
          `Response ${i + 1}`,
          { messageId: `msg-${i}`, promptId: `prompt-${i}` }
        )
      );
      
      // When: Processing concurrently
      const responses = await Promise.all(
        events.map(event => hook.process(event))
      );
      
      // Then: Should handle concurrency correctly (this will fail initially)
      expect(responses).toHaveLength(10);
      expect(responses.every(r => r.success)).toBe(true);
      
      // All should have unique memory IDs
      const memoryIds = responses.map(r => r.data?.memoryEntry?.id);
      expect(new Set(memoryIds)).toHaveSize(10);
    });

    it('should maintain performance with complex analysis', async () => {
      // Given: Complex conversation requiring extensive analysis
      const complexResponse = `
        Here's a comprehensive solution with multiple aspects:
        
        \`\`\`typescript
        // TypeScript implementation
        interface AuthConfig {
          secret: string;
          expiry: number;
        }
        \`\`\`
        
        \`\`\`javascript
        // JavaScript helper
        const helper = { validate: true };
        \`\`\`
        
        \`\`\`json
        { "config": "value" }
        \`\`\`
        
        This solution addresses authentication, authorization, validation, 
        configuration, debugging, testing, and documentation requirements.
        I created auth.ts, updated config.json, and modified helper.js.
      `;
      
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Complex implementation request with multiple requirements',
        complexResponse,
        {
          metadata: {
            toolsUsed: ['Read', 'Write', 'Edit', 'Bash'],
            filesModified: ['auth.ts', 'config.json', 'helper.js']
          }
        }
      );
      
      // When: Processing complex conversation
      const startTime = Date.now();
      const response = await hook.process(event);
      const duration = Date.now() - startTime;
      
      // Then: Should maintain performance despite complexity (this will fail initially)
      expect(response.success).toBe(true);
      expect(duration).toBeLessThan(2000);
      expect(response.data?.memoryEntry?.tags?.length).toBeGreaterThan(5);
      expect(response.data?.memoryEntry?.artifacts?.codeBlocks).toHaveLength(3);
    });
  });

  describe('integration with mock environment', () => {
    it('should execute successfully in mock environment', async () => {
      // Given: Hook and mock environment
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Environment test',
        'Testing in mock environment'
      );
      
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
      // Given: Environment with timeout
      const timeoutEnv = new MockHookEnvironment({ timeout: 3000 });
      const event = eventGenerator.createAssistantPostMessageEvent(
        'Timeout test',
        'Response for timeout testing'
      );
      
      // When: Executing with timeout constraint
      const response = await timeoutEnv.executeHook(
        (e) => hook.process(e),
        event
      );
      
      // Then: Should complete within timeout (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.metadata?.executionTime).toBeLessThan(3000);
      
      timeoutEnv.reset();
    });
  });

  describe('error handling', () => {
    it('should handle memory entry creation errors', async () => {
      // Given: Hook that fails during memory entry creation
      const originalCreateMemoryEntry = hook['createMemoryEntry'];
      hook['createMemoryEntry'] = () => { throw new Error('Memory creation failed'); };
      
      const event = eventGenerator.createAssistantPostMessageEvent('test', 'response');
      
      try {
        // When: Processing with memory creation error
        const response = await hook.process(event);
        
        // Then: Should handle gracefully (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.code).toBe('POST_MESSAGE_HOOK_ERROR');
        expect(response.error?.message).toBe('Memory creation failed');
      } finally {
        hook['createMemoryEntry'] = originalCreateMemoryEntry;
      }
    });

    it('should handle quality analysis errors', async () => {
      // Given: Hook that fails during quality analysis
      const originalAnalyzeConversationQuality = hook['analyzeConversationQuality'];
      hook['analyzeConversationQuality'] = () => { throw new Error('Quality analysis failed'); };
      
      const event = eventGenerator.createAssistantPostMessageEvent('test', 'response');
      
      try {
        // When: Processing with quality analysis error
        const response = await hook.process(event);
        
        // Then: Should handle gracefully (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.code).toBe('POST_MESSAGE_HOOK_ERROR');
      } finally {
        hook['analyzeConversationQuality'] = originalAnalyzeConversationQuality;
      }
    });

    it('should include error stack traces for debugging', async () => {
      // Given: Hook that throws with stack trace
      const originalDetermineStorageStrategy = hook['determineStorageStrategy'];
      hook['determineStorageStrategy'] = () => { 
        const error = new Error('Storage strategy failed');
        error.stack = 'Error stack trace here';
        throw error;
      };
      
      const event = eventGenerator.createAssistantPostMessageEvent('test', 'response');
      
      try {
        // When: Processing with error
        const response = await hook.process(event);
        
        // Then: Should include stack trace (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.details?.error).toBe('Error stack trace here');
      } finally {
        hook['determineStorageStrategy'] = originalDetermineStorageStrategy;
      }
    });
  });

  describe('edge cases', () => {
    it('should handle extremely long conversations', async () => {
      // Given: Extremely long conversation
      const extremelyLongPrompt = 'Very long prompt. '.repeat(10000);
      const extremelyLongResponse = 'Very long response. '.repeat(20000);
      const event = eventGenerator.createAssistantPostMessageEvent(extremelyLongPrompt, extremelyLongResponse);
      
      // When: Processing extremely long conversation
      const response = await hook.process(event);
      
      // Then: Should handle gracefully with length limits (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.memoryEntry?.searchableText?.length).toBeLessThanOrEqual(1000);
      expect(response.data?.memoryEntry?.content?.summary?.length).toBeLessThanOrEqual(200);
    });

    it('should handle Unicode and special characters', async () => {
      // Given: Conversation with Unicode content
      const unicodePrompt = '🚀 How do I implement 日本語 support with émojis?';
      const unicodeResponse = '🎯 Here\'s how to add Unicode support: 中文字符处理...';
      const event = eventGenerator.createAssistantPostMessageEvent(unicodePrompt, unicodeResponse);
      
      // When: Processing Unicode conversation
      const response = await hook.process(event);
      
      // Then: Should handle Unicode correctly (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.memoryEntry?.content?.userPrompt).toBe(unicodePrompt);
      expect(response.data?.memoryEntry?.content?.assistantResponse).toBe(unicodeResponse);
    });

    it('should handle null or undefined conversation data', async () => {
      // Given: Event with null conversation data
      const event = eventGenerator.createAssistantPostMessageEvent('test', 'response');
      (event.data as any).userPrompt = null;
      (event.data as any).assistantResponse = undefined;
      
      // When: Processing null conversation data
      const response = await hook.process(event);
      
      // Then: Should handle gracefully with error (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('POST_MESSAGE_HOOK_ERROR');
    });

    it('should handle circular references in metadata', async () => {
      // Given: Event with circular reference in metadata
      const event = eventGenerator.createAssistantPostMessageEvent('test', 'response');
      const circularMetadata: any = { name: 'test' };
      circularMetadata.self = circularMetadata;
      (event.data as any).metadata = circularMetadata;
      
      // When: Processing circular metadata
      const response = await hook.process(event);
      
      // Then: Should handle gracefully without infinite loops (this will fail initially)
      expect(response.success).toBe(true);
    });
  });
});