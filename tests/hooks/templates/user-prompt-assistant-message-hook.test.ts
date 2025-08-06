/**
 * Comprehensive failing tests for UserPromptAssistantMessageHook
 * Following TDD red phase - these tests will fail initially
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { UserPromptAssistantMessageHook, createUserPromptAssistantMessageHook } from '../../../src/hooks/templates/user-prompt-assistant-message-hook.js';
import { HookEventGenerator } from '../mock/hook-event-generator.js';
import { MockHookEnvironment } from '../mock/mock-hook-environment.js';
import { setupTestTimeouts, setupTestCleanup } from '../../utils/test-helpers.js';

describe('UserPromptAssistantMessageHook', () => {
  let hook: UserPromptAssistantMessageHook;
  let eventGenerator: HookEventGenerator;
  let mockEnvironment: MockHookEnvironment;

  setupTestTimeouts(10000);
  setupTestCleanup();

  beforeEach(() => {
    hook = new UserPromptAssistantMessageHook();
    eventGenerator = new HookEventGenerator();
    mockEnvironment = new MockHookEnvironment();
  });

  afterEach(() => {
    eventGenerator.reset();
    mockEnvironment.reset();
  });

  describe('constructor', () => {
    it('should initialize with correct hook configuration', () => {
      // Given: UserPromptAssistantMessageHook constructor
      // When: Creating new instance
      const newHook = new UserPromptAssistantMessageHook();
      
      // Then: Should have correct configuration (this will fail initially)
      expect((newHook as any).hookId).toBe('user-prompt-assistant-message-hook');
      expect((newHook as any).timeout).toBe(1000);
      expect((newHook as any).maxRetries).toBe(1);
      expect((newHook as any).messageBuffer).toBeDefined();
    });

    it('should be creatable via factory function', () => {
      // Given: Factory function
      // When: Creating hook via factory
      const factoryHook = createUserPromptAssistantMessageHook();
      
      // Then: Should create instance with correct type (this will fail initially)
      expect(factoryHook).toBeInstanceOf(UserPromptAssistantMessageHook);
      expect((factoryHook as any).hookId).toBe('user-prompt-assistant-message-hook');
    });

    it('should initialize message buffer', () => {
      // Given: New hook instance
      const newHook = new UserPromptAssistantMessageHook();
      
      // When: Checking message buffer
      const buffer = (newHook as any).messageBuffer;
      
      // Then: Should have initialized buffer (this will fail initially)
      expect(buffer).toBeDefined();
      expect(typeof buffer.addChunk).toBe('function');
      expect(typeof buffer.getMessage).toBe('function');
      expect(typeof buffer.clearMessage).toBe('function');
    });
  });

  describe('message chunk processing', () => {
    it('should process single message chunk', async () => {
      // Given: Single message chunk event
      const messageId = 'msg-123';
      const promptId = 'prompt-456';
      const chunk = { content: 'Hello world', index: 0, isFirst: true, isLast: true };
      
      const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
      
      // When: Processing the chunk
      const response = await hook.process(event);
      
      // Then: Should process successfully (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.captured).toBe(true);
      expect(response.data?.messageId).toBe(messageId);
      expect(response.data?.promptId).toBe(promptId);
      expect(response.data?.chunkIndex).toBe(0);
      expect(response.data?.analysis).toBeDefined();
    });

    it('should accumulate multiple chunks for same message', async () => {
      // Given: Multiple chunks for same message
      const messageId = 'msg-multi';
      const promptId = 'prompt-multi';
      const chunks = [
        { content: 'Hello ', index: 0, isFirst: true, isLast: false },
        { content: 'world', index: 1, isFirst: false, isLast: true },
      ];
      
      // When: Processing chunks sequentially
      const responses = [];
      for (const chunk of chunks) {
        const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
        const response = await hook.process(event);
        responses.push(response);
      }
      
      // Then: Should accumulate and complete on last chunk (this will fail initially)
      expect(responses[0].success).toBe(true);
      expect(responses[0].data?.completeMessage).toBeUndefined();
      
      expect(responses[1].success).toBe(true);
      expect(responses[1].data?.completeMessage).toBeDefined();
      expect(responses[1].data?.completeMessage?.content).toBe('Hello world');
      expect(responses[1].data?.completeMessage?.shouldStore).toBeDefined();
    });

    it('should handle chunks arriving out of order', async () => {
      // Given: Chunks arriving out of order
      const messageId = 'msg-ooo';
      const promptId = 'prompt-ooo';
      const chunks = [
        { content: ' world', index: 1, isFirst: false, isLast: true },
        { content: 'Hello', index: 0, isFirst: true, isLast: false },
      ];
      
      // When: Processing out-of-order chunks
      const responses = [];
      for (const chunk of chunks) {
        const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
        const response = await hook.process(event);
        responses.push(response);
      }
      
      // Then: Should reconstruct message correctly (this will fail initially)
      const lastResponse = responses.find(r => r.data?.completeMessage);
      expect(lastResponse?.data?.completeMessage?.content).toBe('Hello world');
    });

    it('should enforce message buffer size limits', async () => {
      // Given: Extremely large chunk that exceeds buffer size
      const messageId = 'msg-large';
      const promptId = 'prompt-large';
      const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB content
      const chunk = { content: largeContent, index: 0, isFirst: true, isLast: true };
      
      const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
      
      // When: Processing large chunk
      const response = await hook.process(event);
      
      // Then: Should handle buffer overflow (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('MESSAGE_HOOK_ERROR');
      expect(response.error?.message).toContain('buffer exceeded maximum size');
    });
  });

  describe('chunk analysis', () => {
    it('should detect code blocks in chunks', async () => {
      // Given: Chunk with code block
      const chunk = { 
        content: '```typescript\nconst x = 42;\n```', 
        index: 0, 
        isFirst: true, 
        isLast: true 
      };
      const event = eventGenerator.createAssistantMessageEvent('msg-code', 'prompt-code', chunk);
      
      // When: Processing code chunk
      const response = await hook.process(event);
      
      // Then: Should detect code block (this will fail initially)
      expect(response.data?.analysis?.hasCodeBlock).toBe(true);
      expect(response.data?.analysis?.type).toBe('text');
      expect(response.data?.analysis?.length).toBe(chunk.content.length);
    });

    it('should detect tool usage in chunks', async () => {
      // Given: Chunk with tool usage
      const chunk = { 
        content: '<tool>executeCommand</tool>', 
        index: 0, 
        isFirst: true, 
        isLast: true 
      };
      const event = eventGenerator.createAssistantMessageEvent(
        'msg-tool', 
        'prompt-tool', 
        chunk,
        { messageType: 'tool_use' }
      );
      
      // When: Processing tool chunk
      const response = await hook.process(event);
      
      // Then: Should detect tool usage (this will fail initially)
      expect(response.data?.analysis?.hasToolUse).toBe(true);
      expect(response.data?.analysis?.type).toBe('tool_use');
    });

    it('should detect file operations in chunks', async () => {
      // Given: Chunk describing file operations
      const chunk = { 
        content: 'I created the file Button.tsx and updated helper.js', 
        index: 0, 
        isFirst: true, 
        isLast: true 
      };
      const event = eventGenerator.createAssistantMessageEvent('msg-file', 'prompt-file', chunk);
      
      // When: Processing file operation chunk
      const response = await hook.process(event);
      
      // Then: Should detect file operations (this will fail initially)
      expect(response.data?.analysis?.hasFileOperation).toBe(true);
    });

    it('should handle empty or minimal chunks', async () => {
      // Given: Empty chunk
      const chunk = { content: '', index: 0, isFirst: true, isLast: true };
      const event = eventGenerator.createAssistantMessageEvent('msg-empty', 'prompt-empty', chunk);
      
      // When: Processing empty chunk
      const response = await hook.process(event);
      
      // Then: Should handle gracefully (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.analysis?.length).toBe(0);
      expect(response.data?.analysis?.hasCodeBlock).toBe(false);
    });
  });

  describe('complete message analysis', () => {
    it('should analyze complete message for code content', async () => {
      // Given: Complete message with code blocks
      const fullMessage = `
        Here's the implementation:
        \`\`\`typescript
        function authenticate(user: User): boolean {
          return user.isValid();
        }
        \`\`\`
        This should solve your problem.
      `;
      
      const chunks = eventGenerator.createMessageChunks(fullMessage, 50);
      const messageId = 'msg-complete-code';
      const promptId = 'prompt-complete-code';
      
      // When: Processing all chunks
      let finalResponse;
      for (const chunk of chunks) {
        const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
        const response = await hook.process(event);
        if (response.data?.completeMessage) {
          finalResponse = response;
        }
      }
      
      // Then: Should analyze complete message (this will fail initially)
      expect(finalResponse?.data?.completeMessage?.analysis?.hasCode).toBe(true);
      expect(finalResponse?.data?.completeMessage?.analysis?.categories).toContain('code');
      expect(finalResponse?.data?.completeMessage?.analysis?.importance).toBeGreaterThan(0.5);
    });

    it('should detect explanations in complete messages', async () => {
      // Given: Message with explanations
      const explanationMessage = 'This happens because the authentication fails. Therefore, you need to check the credentials.';
      const chunks = eventGenerator.createMessageChunks(explanationMessage, 30);
      const messageId = 'msg-explanation';
      const promptId = 'prompt-explanation';
      
      // When: Processing explanation message
      let finalResponse;
      for (const chunk of chunks) {
        const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
        const response = await hook.process(event);
        if (response.data?.completeMessage) {
          finalResponse = response;
        }
      }
      
      // Then: Should detect explanation (this will fail initially)
      expect(finalResponse?.data?.completeMessage?.analysis?.hasExplanation).toBe(true);
      expect(finalResponse?.data?.completeMessage?.analysis?.categories).toContain('explanation');
    });

    it('should detect errors in complete messages', async () => {
      // Given: Message about errors
      const errorMessage = 'There was an error in your code. The exception was thrown because of a failed validation.';
      const chunks = eventGenerator.createMessageChunks(errorMessage, 25);
      const messageId = 'msg-error';
      const promptId = 'prompt-error';
      
      // When: Processing error message
      let finalResponse;
      for (const chunk of chunks) {
        const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
        const response = await hook.process(event);
        if (response.data?.completeMessage) {
          finalResponse = response;
        }
      }
      
      // Then: Should detect error content (this will fail initially)
      expect(finalResponse?.data?.completeMessage?.analysis?.hasError).toBe(true);
      expect(finalResponse?.data?.completeMessage?.analysis?.categories).toContain('error');
      expect(finalResponse?.data?.completeMessage?.analysis?.importance).toBeGreaterThan(0.7);
    });

    it('should extract tool usage from complete messages', async () => {
      // Given: Message with tool usage
      const toolMessage = 'I used <tool>Read</tool> and <tool>Write</tool> to help you.';
      const chunks = eventGenerator.createMessageChunks(toolMessage, 20);
      const messageId = 'msg-tools';
      const promptId = 'prompt-tools';
      
      // When: Processing tool message
      let finalResponse;
      for (const chunk of chunks) {
        const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
        const response = await hook.process(event);
        if (response.data?.completeMessage) {
          finalResponse = response;
        }
      }
      
      // Then: Should extract tools used (this will fail initially)
      expect(finalResponse?.data?.completeMessage?.analysis?.toolsUsed).toEqual(['Read', 'Write']);
      expect(finalResponse?.data?.completeMessage?.analysis?.categories).toContain('tool_usage');
    });

    it('should extract file modifications from complete messages', async () => {
      // Given: Message with file modifications
      const fileMessage = 'I created Button.tsx, updated helper.js, and modified config.json for you.';
      const chunks = eventGenerator.createMessageChunks(fileMessage, 25);
      const messageId = 'msg-files';
      const promptId = 'prompt-files';
      
      // When: Processing file message
      let finalResponse;
      for (const chunk of chunks) {
        const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
        const response = await hook.process(event);
        if (response.data?.completeMessage) {
          finalResponse = response;
        }
      }
      
      // Then: Should extract file modifications (this will fail initially)
      expect(finalResponse?.data?.completeMessage?.analysis?.filesModified).toContain('Button.tsx');
      expect(finalResponse?.data?.completeMessage?.analysis?.filesModified).toContain('helper.js');
      expect(finalResponse?.data?.completeMessage?.analysis?.filesModified).toContain('config.json');
      expect(finalResponse?.data?.completeMessage?.analysis?.categories).toContain('file_operations');
    });

    it('should calculate importance based on message length', async () => {
      // Given: Short and long messages
      const shortMessage = 'OK';
      const longMessage = 'x'.repeat(5000);
      
      // When: Processing both messages
      const shortEvent = eventGenerator.createAssistantMessageEvent(
        'msg-short', 'prompt-short', 
        { content: shortMessage, index: 0, isFirst: true, isLast: true }
      );
      const longEvent = eventGenerator.createAssistantMessageEvent(
        'msg-long', 'prompt-long',
        { content: longMessage, index: 0, isFirst: true, isLast: true }
      );
      
      const shortResponse = await hook.process(shortEvent);
      const longResponse = await hook.process(longEvent);
      
      // Then: Should weight longer messages higher (this will fail initially)
      const shortImportance = shortResponse.data?.completeMessage?.analysis?.importance || 0;
      const longImportance = longResponse.data?.completeMessage?.analysis?.importance || 0;
      expect(longImportance).toBeGreaterThan(shortImportance);
    });

    it('should determine indexing priority correctly', async () => {
      // Given: High importance message
      const importantMessage = `
        Here's the solution with error handling:
        \`\`\`typescript
        function critical() { /* implementation */ }
        \`\`\`
        I created solution.ts and updated config.json.
      `;
      
      const chunks = eventGenerator.createMessageChunks(importantMessage, 50);
      const messageId = 'msg-priority';
      const promptId = 'prompt-priority';
      
      // When: Processing important message
      let finalResponse;
      for (const chunk of chunks) {
        const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
        const response = await hook.process(event);
        if (response.data?.completeMessage) {
          finalResponse = response;
        }
      }
      
      // Then: Should have high indexing priority (this will fail initially)
      expect(finalResponse?.data?.completeMessage?.indexingPriority).toBe('high');
      expect(finalResponse?.data?.completeMessage?.shouldStore).toBe(true);
    });
  });

  describe('message buffer management', () => {
    it('should clear completed messages from buffer', async () => {
      // Given: Complete message that should be cleared
      const messageId = 'msg-clear';
      const promptId = 'prompt-clear';
      const chunk = { content: 'Complete message', index: 0, isFirst: true, isLast: true };
      
      const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
      
      // When: Processing complete message
      await hook.process(event);
      
      // Then: Message should be cleared from buffer (this will fail initially)
      const buffer = (hook as any).messageBuffer;
      expect(buffer.getMessage(messageId)).toBeNull();
    });

    it('should perform periodic cleanup of old messages', async () => {
      // Given: Hook that triggers cleanup (1% chance per call, so we'll force it)
      const originalMathRandom = Math.random;
      Math.random = () => 0.005; // Force cleanup trigger
      
      try {
        const event = eventGenerator.createAssistantMessageEvent(
          'msg-cleanup', 
          'prompt-cleanup',
          { content: 'Cleanup test', index: 0, isFirst: true, isLast: false }
        );
        
        // When: Processing event that triggers cleanup
        const response = await hook.process(event);
        
        // Then: Should succeed and trigger cleanup (this will fail initially)
        expect(response.success).toBe(true);
        // Cleanup should be called internally
      } finally {
        Math.random = originalMathRandom;
      }
    });

    it('should handle buffer overflow gracefully', async () => {
      // Given: Multiple large messages that could overflow buffer
      const largeContent = 'x'.repeat(500000); // 500KB per chunk
      const events = Array.from({ length: 5 }, (_, i) => 
        eventGenerator.createAssistantMessageEvent(
          `msg-overflow-${i}`,
          `prompt-overflow-${i}`,
          { content: largeContent, index: 0, isFirst: true, isLast: false }
        )
      );
      
      // When: Processing multiple large chunks
      const responses = await Promise.all(
        events.map(event => hook.process(event))
      );
      
      // Then: Should handle overflow appropriately (this will fail initially)
      const errorResponses = responses.filter(r => !r.success);
      expect(errorResponses.length).toBeGreaterThan(0);
      expect(errorResponses[0].error?.message).toContain('buffer exceeded maximum size');
    });
  });

  describe('event validation', () => {
    it('should reject events with invalid schema', async () => {
      // Given: Event with missing required fields
      const invalidEvent = eventGenerator.createAssistantMessageEvent('msg', 'prompt', {
        content: 'test',
        index: 0
      });
      delete (invalidEvent.data as any).messageId;
      
      // When: Processing invalid event
      const response = await hook.process(invalidEvent);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('MESSAGE_HOOK_ERROR');
    });

    it('should validate chunk structure', async () => {
      // Given: Event with invalid chunk structure
      const invalidEvent = eventGenerator.createAssistantMessageEvent('msg', 'prompt', {
        content: 'test',
        index: 0
      });
      (invalidEvent.data as any).chunk = 'invalid-chunk'; // Should be object
      
      // When: Processing invalid event
      const response = await hook.process(invalidEvent);
      
      // Then: Should return error response (this will fail initially)
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('MESSAGE_HOOK_ERROR');
    });

    it('should handle negative chunk indices', async () => {
      // Given: Event with negative chunk index
      const event = eventGenerator.createAssistantMessageEvent('msg', 'prompt', {
        content: 'test',
        index: -1,
        isFirst: true,
        isLast: true
      });
      
      // When: Processing event with negative index
      const response = await hook.process(event);
      
      // Then: Should handle gracefully or error appropriately (this will fail initially)
      expect(response.success).toBe(true); // Or false if validation rejects it
    });
  });

  describe('performance and concurrency', () => {
    it('should handle high-frequency chunk processing', async () => {
      // Given: Many chunks arriving rapidly
      const messageId = 'msg-freq';
      const promptId = 'prompt-freq';
      const chunkCount = 50;
      const events = Array.from({ length: chunkCount }, (_, i) => 
        eventGenerator.createAssistantMessageEvent(messageId, promptId, {
          content: `chunk-${i}`,
          index: i,
          isFirst: i === 0,
          isLast: i === chunkCount - 1
        })
      );
      
      // When: Processing all chunks rapidly
      const startTime = Date.now();
      const responses = await Promise.all(
        events.map(event => hook.process(event))
      );
      const duration = Date.now() - startTime;
      
      // Then: Should handle efficiently (this will fail initially)
      expect(responses).toHaveLength(chunkCount);
      expect(responses.every(r => r.success)).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      
      // Last response should have complete message
      const lastResponse = responses[responses.length - 1];
      expect(lastResponse.data?.completeMessage).toBeDefined();
    });

    it('should handle concurrent messages efficiently', async () => {
      // Given: Multiple messages being processed concurrently
      const messageCount = 10;
      const events = Array.from({ length: messageCount }, (_, i) => 
        eventGenerator.createAssistantMessageEvent(
          `msg-concurrent-${i}`,
          `prompt-concurrent-${i}`,
          { content: `Message ${i + 1}`, index: 0, isFirst: true, isLast: true }
        )
      );
      
      // When: Processing concurrently
      const responses = await Promise.all(
        events.map(event => hook.process(event))
      );
      
      // Then: Should handle concurrency correctly (this will fail initially)
      expect(responses).toHaveLength(messageCount);
      expect(responses.every(r => r.success)).toBe(true);
      expect(new Set(responses.map(r => r.data?.messageId))).toHaveSize(messageCount);
    });

    it('should maintain performance under timeout constraints', async () => {
      // Given: Event processed under strict timeout
      const event = eventGenerator.createAssistantMessageEvent('msg-timeout', 'prompt-timeout', {
        content: 'Timeout test message',
        index: 0,
        isFirst: true,
        isLast: true
      });
      
      // When: Processing with timing constraints
      const startTime = Date.now();
      const response = await hook.process(event);
      const duration = Date.now() - startTime;
      
      // Then: Should complete within timeout (this will fail initially)
      expect(response.success).toBe(true);
      expect(duration).toBeLessThan(1000); // Hook timeout is 1000ms
    });
  });

  describe('integration with mock environment', () => {
    it('should execute successfully in mock environment', async () => {
      // Given: Hook and mock environment
      const event = eventGenerator.createAssistantMessageEvent('msg-env', 'prompt-env', {
        content: 'Environment test',
        index: 0,
        isFirst: true,
        isLast: true
      });
      
      // When: Executing in mock environment
      const response = await mockEnvironment.executeHook(
        (e) => hook.process(e),
        event
      );
      
      // Then: Should succeed with execution metadata (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.metadata?.executionTime).toBeGreaterThan(0);
    });

    it('should handle environment latency simulation', async () => {
      // Given: Environment with simulated latency
      const latencyEnv = new MockHookEnvironment({ simulateLatency: 100 });
      const event = eventGenerator.createAssistantMessageEvent('msg-latency', 'prompt-latency', {
        content: 'Latency test',
        index: 0,
        isFirst: true,
        isLast: true
      });
      
      // When: Executing with latency
      const startTime = Date.now();
      const response = await latencyEnv.executeHook(
        (e) => hook.process(e),
        event
      );
      const duration = Date.now() - startTime;
      
      // Then: Should account for latency (this will fail initially)
      expect(response.success).toBe(true);
      expect(duration).toBeGreaterThan(100);
      
      latencyEnv.reset();
    });
  });

  describe('error handling', () => {
    it('should handle buffer errors gracefully', async () => {
      // Given: Hook with failing buffer operation
      const originalAddChunk = (hook as any).messageBuffer.addChunk;
      (hook as any).messageBuffer.addChunk = () => { throw new Error('Buffer error'); };
      
      const event = eventGenerator.createAssistantMessageEvent('msg-buffer-error', 'prompt-buffer-error', {
        content: 'Buffer test',
        index: 0,
        isFirst: true,
        isLast: true
      });
      
      try {
        // When: Processing with buffer error
        const response = await hook.process(event);
        
        // Then: Should handle gracefully (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.code).toBe('MESSAGE_HOOK_ERROR');
        expect(response.error?.message).toBe('Buffer error');
      } finally {
        (hook as any).messageBuffer.addChunk = originalAddChunk;
      }
    });

    it('should handle analysis errors gracefully', async () => {
      // Given: Hook with failing chunk analysis
      const originalAnalyzeChunk = hook['analyzeChunk'];
      hook['analyzeChunk'] = () => { throw new Error('Analysis failed'); };
      
      const event = eventGenerator.createAssistantMessageEvent('msg-analysis-error', 'prompt-analysis-error', {
        content: 'Analysis test',
        index: 0,
        isFirst: true,
        isLast: true
      });
      
      try {
        // When: Processing with analysis error
        const response = await hook.process(event);
        
        // Then: Should handle gracefully (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.code).toBe('MESSAGE_HOOK_ERROR');
      } finally {
        hook['analyzeChunk'] = originalAnalyzeChunk;
      }
    });

    it('should include error stack traces for debugging', async () => {
      // Given: Hook that throws with stack trace
      const originalValidateEvent = hook['validateEvent'];
      hook['validateEvent'] = () => { 
        const error = new Error('Validation failed');
        error.stack = 'Error stack trace here';
        throw error;
      };
      
      const event = eventGenerator.createAssistantMessageEvent('msg-stack', 'prompt-stack', {
        content: 'Stack test',
        index: 0
      });
      
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

  describe('edge cases', () => {
    it('should handle extremely large chunk indices', async () => {
      // Given: Event with very large chunk index
      const event = eventGenerator.createAssistantMessageEvent('msg-large-index', 'prompt-large-index', {
        content: 'Large index test',
        index: Number.MAX_SAFE_INTEGER,
        isFirst: false,
        isLast: true
      });
      
      // When: Processing large index
      const response = await hook.process(event);
      
      // Then: Should handle gracefully (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.chunkIndex).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle Unicode content in chunks', async () => {
      // Given: Chunk with Unicode content
      const unicodeContent = '🚀 Unicode test with émojis and 日本語 characters';
      const event = eventGenerator.createAssistantMessageEvent('msg-unicode', 'prompt-unicode', {
        content: unicodeContent,
        index: 0,
        isFirst: true,
        isLast: true
      });
      
      // When: Processing Unicode chunk
      const response = await hook.process(event);
      
      // Then: Should handle Unicode correctly (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.completeMessage?.content).toBe(unicodeContent);
    });

    it('should handle malformed tool tags', async () => {
      // Given: Chunk with malformed tool tags
      const malformedContent = '<tool>incomplete tool tag and <tool>another</tool> proper one';
      const event = eventGenerator.createAssistantMessageEvent('msg-malformed', 'prompt-malformed', {
        content: malformedContent,
        index: 0,
        isFirst: true,
        isLast: true
      });
      
      // When: Processing malformed content
      const response = await hook.process(event);
      
      // Then: Should handle gracefully (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.completeMessage?.analysis?.toolsUsed).toEqual(['another']);
    });

    it('should handle null message metadata', async () => {
      // Given: Event with null metadata
      const event = eventGenerator.createAssistantMessageEvent('msg-null', 'prompt-null', {
        content: 'Null metadata test',
        index: 0,
        isFirst: true,
        isLast: true
      });
      (event.data as any).metadata = null;
      
      // When: Processing event with null metadata
      const response = await hook.process(event);
      
      // Then: Should handle gracefully (this will fail initially)
      expect(response.success).toBe(true);
    });
  });
});