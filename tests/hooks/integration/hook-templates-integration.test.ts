/**
 * Integration tests for hook templates working together
 * Tests complete workflow and interaction between different hooks
 * Following TDD red phase - these tests will fail initially
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  UserPromptSubmitHook,
  UserPromptAssistantPreMessageHook,
  UserPromptAssistantMessageHook,
  UserPromptAssistantPostMessageHook
} from '../../../src/hooks/templates/index.js';
import { HookEventGenerator, MockHookEnvironment, MockCircuitBreaker } from '../mock/index.js';
import { setupTestTimeouts, setupTestCleanup } from '../../utils/test-helpers.js';

describe('Hook Templates Integration', () => {
  let promptSubmitHook: UserPromptSubmitHook;
  let preMessageHook: UserPromptAssistantPreMessageHook;
  let messageHook: UserPromptAssistantMessageHook;
  let postMessageHook: UserPromptAssistantPostMessageHook;
  let eventGenerator: HookEventGenerator;
  let mockEnvironment: MockHookEnvironment;
  let circuitBreaker: MockCircuitBreaker;

  setupTestTimeouts(15000); // Longer timeout for integration tests
  setupTestCleanup();

  beforeEach(() => {
    promptSubmitHook = new UserPromptSubmitHook();
    preMessageHook = new UserPromptAssistantPreMessageHook();
    messageHook = new UserPromptAssistantMessageHook();
    postMessageHook = new UserPromptAssistantPostMessageHook();
    eventGenerator = new HookEventGenerator();
    mockEnvironment = new MockHookEnvironment();
    circuitBreaker = new MockCircuitBreaker();
  });

  afterEach(() => {
    eventGenerator.reset();
    mockEnvironment.reset();
    circuitBreaker.reset();
  });

  describe('complete conversation flow', () => {
    it('should process a complete conversation workflow', async () => {
      // Given: A complete conversation scenario
      const userPrompt = 'How do I implement JWT authentication in TypeScript?';
      const assistantResponse = `
        Here's how to implement JWT authentication:
        
        \`\`\`typescript
        import jwt from 'jsonwebtoken';
        
        interface AuthPayload {
          userId: string;
          email: string;
        }
        
        function generateToken(payload: AuthPayload): string {
          return jwt.sign(payload, process.env.JWT_SECRET!);
        }
        \`\`\`
        
        I also created auth.ts and updated the config file.
      `;
      
      // Step 1: User submits prompt
      const promptSubmitEvent = eventGenerator.createUserPromptSubmitEvent(
        userPrompt,
        { source: 'chat', language: 'typescript' }
      );
      
      const promptSubmitResponse = await promptSubmitHook.process(promptSubmitEvent);
      
      // Step 2: Pre-message context injection
      const preMessageEvent = eventGenerator.createAssistantPreMessageEvent(
        userPrompt,
        { contextRequested: true, maxContextTokens: 2000 }
      );
      
      const preMessageResponse = await preMessageHook.process(preMessageEvent);
      
      // Step 3: Process message chunks
      const messageChunks = eventGenerator.createMessageChunks(assistantResponse, 100);
      const messageId = 'msg-integration-test';
      const promptId = 'prompt-integration-test';
      
      const messageResponses = [];
      for (const chunk of messageChunks) {
        const messageEvent = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
        const messageResponse = await messageHook.process(messageEvent);
        messageResponses.push(messageResponse);
      }
      
      // Step 4: Post-message processing
      const postMessageEvent = eventGenerator.createAssistantPostMessageEvent(
        userPrompt,
        assistantResponse,
        {
          messageId,
          promptId,
          metadata: {
            model: 'claude-3-sonnet',
            tokensUsed: 250,
            toolsUsed: ['Write'],
            filesModified: ['auth.ts', 'config.json']
          },
          outcome: { success: true, errorCount: 0, warningCount: 0 }
        }
      );
      
      const postMessageResponse = await postMessageHook.process(postMessageEvent);
      
      // Then: All steps should succeed and build upon each other (this will fail initially)
      expect(promptSubmitResponse.success).toBe(true);
      expect(promptSubmitResponse.data?.type).toBe('user_prompt');
      expect(promptSubmitResponse.data?.capture).toBe(true);
      
      expect(preMessageResponse.success).toBe(true);
      expect(preMessageResponse.data?.inject).toBe(true);
      expect(preMessageResponse.data?.context?.relevantMemories).toContain('code_analysis');
      
      expect(messageResponses.every(r => r.success)).toBe(true);
      const finalMessageResponse = messageResponses[messageResponses.length - 1];
      expect(finalMessageResponse.data?.completeMessage?.shouldStore).toBe(true);
      
      expect(postMessageResponse.success).toBe(true);
      expect(postMessageResponse.data?.store).toBe(true);
      expect(postMessageResponse.data?.quality?.score).toBeGreaterThan(0.7);
    });

    it('should handle conversation with errors gracefully', async () => {
      // Given: A conversation that encounters errors
      const userPrompt = 'Fix this broken code';
      const assistantResponse = 'I encountered some issues while trying to fix the code.';
      
      // When: Processing conversation with error outcome
      const postMessageEvent = eventGenerator.createAssistantPostMessageEvent(
        userPrompt,
        assistantResponse,
        {
          outcome: { success: false, errorCount: 2, warningCount: 1 }
        }
      );
      
      const response = await postMessageHook.process(postMessageEvent);
      
      // Then: Should handle gracefully with appropriate quality assessment (this will fail initially)
      expect(response.success).toBe(true);
      expect(response.data?.quality?.score).toBeLessThan(0.5);
      expect(response.data?.store).toBe(false); // Low quality without artifacts
    });

    it('should maintain consistency across hook executions', async () => {
      // Given: Same prompt processed by different hooks
      const userPrompt = 'Create a React component with error handling';
      const promptId = 'consistent-prompt-id';
      
      // When: Processing through multiple hooks
      const promptSubmitEvent = eventGenerator.createUserPromptSubmitEvent(userPrompt);
      const preMessageEvent = eventGenerator.createAssistantPreMessageEvent(
        userPrompt,
        { promptId }
      );
      
      const promptSubmitResponse = await promptSubmitHook.process(promptSubmitEvent);
      const preMessageResponse = await preMessageHook.process(preMessageEvent);
      
      // Then: Should maintain consistency in context extraction (this will fail initially)
      expect(promptSubmitResponse.metadata?.workspaceId).toBe(preMessageResponse.metadata?.workspaceId);
      expect(promptSubmitResponse.metadata?.sessionId).toBe(preMessageResponse.metadata?.sessionId);
    });
  });

  describe('hook coordination patterns', () => {
    it('should coordinate context from prompt submit to pre-message', async () => {
      // Given: Prompt with file references and code
      const userPrompt = 'Debug the error in ./src/auth.ts function validateToken()';
      
      // When: Processing through prompt submit and pre-message hooks
      const promptSubmitEvent = eventGenerator.createUserPromptSubmitEvent(
        userPrompt,
        { source: 'file', filePath: './src/auth.ts', lineNumber: 42 }
      );
      
      const preMessageEvent = eventGenerator.createAssistantPreMessageEvent(userPrompt);
      
      const promptSubmitResponse = await promptSubmitHook.process(promptSubmitEvent);
      const preMessageResponse = await preMessageHook.process(preMessageEvent);
      
      // Then: Pre-message should leverage context from prompt (this will fail initially)
      expect(promptSubmitResponse.data?.fileReferences).toContain('./src/auth.ts');
      expect(preMessageResponse.data?.context?.relevantMemories).toContain('error_diagnostics');
      expect(preMessageResponse.data?.context?.searchQueries).toContain('./src/auth.ts');
      expect(preMessageResponse.data?.context?.priority).toBe('high');
    });

    it('should coordinate streaming messages with final processing', async () => {
      // Given: Streaming message that creates code and files
      const fullResponse = `
        I'll create the authentication module:
        
        \`\`\`typescript
        export function authenticate(token: string): boolean {
          return jwt.verify(token, secret);
        }
        \`\`\`
        
        I've created auth.ts with the implementation.
      `;
      
      const messageId = 'stream-coord-test';
      const promptId = 'stream-coord-prompt';
      const chunks = eventGenerator.createMessageChunks(fullResponse, 50);
      
      // When: Processing streaming chunks and final message
      const messageResponses = [];
      for (const chunk of chunks) {
        const messageEvent = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
        const response = await messageHook.process(messageEvent);
        messageResponses.push(response);
      }
      
      const postMessageEvent = eventGenerator.createAssistantPostMessageEvent(
        'Create auth module',
        fullResponse,
        {
          messageId,
          promptId,
          metadata: { filesModified: ['auth.ts'] }
        }
      );
      
      const postMessageResponse = await postMessageHook.process(postMessageEvent);
      
      // Then: Should coordinate analysis between streaming and final processing (this will fail initially)
      const finalChunkResponse = messageResponses[messageResponses.length - 1];
      expect(finalChunkResponse.data?.completeMessage?.analysis?.hasCode).toBe(true);
      expect(finalChunkResponse.data?.completeMessage?.analysis?.filesModified).toContain('auth.ts');
      
      expect(postMessageResponse.data?.memoryEntry?.artifacts?.codeBlocks).toHaveLength(1);
      expect(postMessageResponse.data?.memoryEntry?.artifacts?.files).toContain('auth.ts');
      expect(postMessageResponse.data?.memoryEntry?.tags).toContain('typescript');
    });

    it('should handle coordinated error scenarios', async () => {
      // Given: Error that propagates through hooks
      const errorPrompt = 'This will cause processing errors';
      
      // When: Simulating errors in hook chain
      const originalValidateEvent = promptSubmitHook['validateEvent'];
      promptSubmitHook['validateEvent'] = () => { throw new Error('Validation error'); };
      
      try {
        const promptSubmitEvent = eventGenerator.createUserPromptSubmitEvent(errorPrompt);
        const promptSubmitResponse = await promptSubmitHook.process(promptSubmitEvent);
        
        // Then: Should handle errors gracefully without breaking chain (this will fail initially)
        expect(promptSubmitResponse.success).toBe(false);
        expect(promptSubmitResponse.error?.code).toBe('HOOK_PROCESSING_ERROR');
        
        // Subsequent hooks should still work independently
        const preMessageEvent = eventGenerator.createAssistantPreMessageEvent(errorPrompt);
        const preMessageResponse = await preMessageHook.process(preMessageEvent);
        expect(preMessageResponse.success).toBe(true);
      } finally {
        promptSubmitHook['validateEvent'] = originalValidateEvent;
      }
    });
  });

  describe('performance under load', () => {
    it('should handle concurrent conversations efficiently', async () => {
      // Given: Multiple concurrent conversations
      const conversationCount = 5;
      const conversations = Array.from({ length: conversationCount }, (_, i) => ({
        userPrompt: `Conversation ${i + 1}: How do I implement feature X?`,
        assistantResponse: `Response ${i + 1}: Here's how to implement feature X...`,
        messageId: `msg-concurrent-${i}`,
        promptId: `prompt-concurrent-${i}`
      }));
      
      // When: Processing all conversations concurrently
      const startTime = Date.now();
      
      const allPromises = conversations.map(async (conv) => {
        // Process complete workflow for each conversation
        const promptSubmitEvent = eventGenerator.createUserPromptSubmitEvent(conv.userPrompt);
        const preMessageEvent = eventGenerator.createAssistantPreMessageEvent(conv.userPrompt);
        const messageEvent = eventGenerator.createAssistantMessageEvent(
          conv.messageId,
          conv.promptId,
          { content: conv.assistantResponse, index: 0, isFirst: true, isLast: true }
        );
        const postMessageEvent = eventGenerator.createAssistantPostMessageEvent(
          conv.userPrompt,
          conv.assistantResponse,
          { messageId: conv.messageId, promptId: conv.promptId }
        );
        
        const [promptSubmit, preMessage, message, postMessage] = await Promise.all([
          promptSubmitHook.process(promptSubmitEvent),
          preMessageHook.process(preMessageEvent),
          messageHook.process(messageEvent),
          postMessageHook.process(postMessageEvent)
        ]);
        
        return { promptSubmit, preMessage, message, postMessage };
      });
      
      const results = await Promise.all(allPromises);
      const duration = Date.now() - startTime;
      
      // Then: Should handle concurrent load efficiently (this will fail initially)
      expect(results).toHaveLength(conversationCount);
      expect(results.every(r => r.promptSubmit.success)).toBe(true);
      expect(results.every(r => r.preMessage.success)).toBe(true);
      expect(results.every(r => r.message.success)).toBe(true);
      expect(results.every(r => r.postMessage.success)).toBe(true);
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
    });

    it('should maintain performance with large message streams', async () => {
      // Given: Large streaming message
      const largeResponse = 'Large response content. '.repeat(2000); // ~40KB
      const chunks = eventGenerator.createMessageChunks(largeResponse, 100);
      const messageId = 'large-stream-test';
      const promptId = 'large-stream-prompt';
      
      // When: Processing large stream
      const startTime = Date.now();
      
      const chunkPromises = chunks.map(chunk => {
        const event = eventGenerator.createAssistantMessageEvent(messageId, promptId, chunk);
        return messageHook.process(event);
      });
      
      const chunkResponses = await Promise.all(chunkPromises);
      const streamDuration = Date.now() - startTime;
      
      // Process final message
      const postMessageEvent = eventGenerator.createAssistantPostMessageEvent(
        'Large message test',
        largeResponse
      );
      const postMessageResponse = await postMessageHook.process(postMessageEvent);
      const totalDuration = Date.now() - startTime;
      
      // Then: Should maintain performance with large streams (this will fail initially)
      expect(chunkResponses.every(r => r.success)).toBe(true);
      expect(postMessageResponse.success).toBe(true);
      expect(streamDuration).toBeLessThan(5000); // Stream processing under 5s
      expect(totalDuration).toBeLessThan(8000); // Total processing under 8s
    });
  });

  describe('circuit breaker integration', () => {
    it('should integrate with circuit breaker for resilience', async () => {
      // Given: Hooks integrated with circuit breaker
      const executeWithCircuitBreaker = async (hookFn: () => Promise<any>, operationName: string) => {
        return circuitBreaker.execute(hookFn, operationName);
      };
      
      // When: Processing through circuit breaker
      const event = eventGenerator.createUserPromptSubmitEvent('Circuit breaker test');
      
      const response = await executeWithCircuitBreaker(
        () => promptSubmitHook.process(event),
        'promptSubmitHook'
      );
      
      // Then: Should work with circuit breaker (this will fail initially)
      expect(response.success).toBe(true);
      expect(circuitBreaker.getStats().totalCalls).toBe(1);
      expect(circuitBreaker.getStats().successCount).toBe(1);
    });

    it('should handle circuit breaker failures gracefully', async () => {
      // Given: Circuit breaker that will fail
      circuitBreaker.simulateFailures(5); // Force circuit to open
      expect(circuitBreaker.getStats().state).toBe('OPEN');
      
      // When: Attempting to process with open circuit
      const event = eventGenerator.createUserPromptSubmitEvent('Open circuit test');
      
      // Then: Should reject calls due to open circuit (this will fail initially)
      await expect(
        circuitBreaker.execute(() => promptSubmitHook.process(event), 'promptSubmitHook')
      ).rejects.toThrow('Circuit breaker is OPEN');
    });

    it('should handle half-open circuit recovery', async () => {
      // Given: Circuit in half-open state
      circuitBreaker.forceState('HALF_OPEN');
      
      // When: Processing successful operations in half-open state
      const events = Array.from({ length: 3 }, (_, i) => 
        eventGenerator.createUserPromptSubmitEvent(`Recovery test ${i + 1}`)
      );
      
      const responses = [];
      for (const event of events) {
        const response = await circuitBreaker.execute(
          () => promptSubmitHook.process(event),
          'promptSubmitHook'
        );
        responses.push(response);
      }
      
      // Then: Should recover to closed state (this will fail initially)
      expect(responses.every(r => r.success)).toBe(true);
      expect(circuitBreaker.getStats().state).toBe('CLOSED');
    });
  });

  describe('environment integration', () => {
    it('should work within mock environment constraints', async () => {
      // Given: Mock environment with constraints
      const constrainedEnv = new MockHookEnvironment({
        timeout: 2000,
        simulateLatency: 50,
        enableSandbox: true
      });
      
      // When: Processing full workflow in constrained environment
      const userPrompt = 'Environment constraint test';
      const assistantResponse = 'Response under constraints';
      
      const promptSubmitEvent = eventGenerator.createUserPromptSubmitEvent(userPrompt);
      const postMessageEvent = eventGenerator.createAssistantPostMessageEvent(userPrompt, assistantResponse);
      
      const promptSubmitResponse = await constrainedEnv.executeHook(
        (e) => promptSubmitHook.process(e),
        promptSubmitEvent
      );
      
      const postMessageResponse = await constrainedEnv.executeHook(
        (e) => postMessageHook.process(e),
        postMessageEvent
      );
      
      // Then: Should work within environment constraints (this will fail initially)
      expect(promptSubmitResponse.success).toBe(true);
      expect(postMessageResponse.success).toBe(true);
      expect(promptSubmitResponse.metadata?.executionTime).toBeGreaterThan(50); // Includes latency
      expect(postMessageResponse.metadata?.executionTime).toBeGreaterThan(50);
      
      constrainedEnv.reset();
    });

    it('should handle environment failures gracefully', async () => {
      // Given: Environment with high failure rate
      const failingEnv = new MockHookEnvironment({ failureRate: 0.8 });
      
      // When: Processing in failing environment
      const event = eventGenerator.createUserPromptSubmitEvent('Failure test');
      
      let failures = 0;
      let successes = 0;
      
      // Try multiple times to account for random failure rate
      for (let i = 0; i < 10; i++) {
        try {
          await failingEnv.executeHook((e) => promptSubmitHook.process(e), event);
          successes++;
        } catch (error) {
          failures++;
        }
      }
      
      // Then: Should have some failures due to environment (this will fail initially)
      expect(failures).toBeGreaterThan(5); // Should have failures due to 80% failure rate
      expect(successes).toBeGreaterThan(0); // Should have some successes
      
      failingEnv.reset();
    });
  });

  describe('data flow and consistency', () => {
    it('should maintain data consistency across hook chain', async () => {
      // Given: Complex conversation with consistent IDs
      const conversationId = 'consistent-conv-123';
      const messageId = 'consistent-msg-456';
      const promptId = 'consistent-prompt-789';
      
      const userPrompt = 'Consistent data flow test';
      const assistantResponse = 'Response with consistent IDs';
      
      // When: Processing with consistent IDs through chain
      const preMessageEvent = eventGenerator.createAssistantPreMessageEvent(
        userPrompt,
        { promptId }
      );
      
      const messageEvent = eventGenerator.createAssistantMessageEvent(
        messageId,
        promptId,
        { content: assistantResponse, index: 0, isFirst: true, isLast: true }
      );
      
      const postMessageEvent = eventGenerator.createAssistantPostMessageEvent(
        userPrompt,
        assistantResponse,
        { messageId, promptId, conversationId }
      );
      
      const preMessageResponse = await preMessageHook.process(preMessageEvent);
      const messageResponse = await messageHook.process(messageEvent);
      const postMessageResponse = await postMessageHook.process(postMessageEvent);
      
      // Then: Should maintain ID consistency (this will fail initially)
      expect(preMessageResponse.data?.metadata?.promptId).toBe(promptId);
      expect(messageResponse.data?.messageId).toBe(messageId);
      expect(messageResponse.data?.promptId).toBe(promptId);
      expect(postMessageResponse.data?.crossReference?.messageId).toBe(messageId);
      expect(postMessageResponse.data?.crossReference?.promptId).toBe(promptId);
      expect(postMessageResponse.data?.crossReference?.conversationId).toBe(conversationId);
    });

    it('should handle data transformations correctly', async () => {
      // Given: Data that needs transformation/sanitization
      const sensitivePrompt = 'My API key is sk-1234567890 and I need help with authentication';
      const responseWithCode = `
        Here's the sanitized version:
        \`\`\`typescript
        const apiKey = process.env.API_KEY; // Don't hardcode keys
        \`\`\`
      `;
      
      // When: Processing through sanitization and extraction
      const promptSubmitEvent = eventGenerator.createUserPromptSubmitEvent(sensitivePrompt);
      const postMessageEvent = eventGenerator.createAssistantPostMessageEvent(
        sensitivePrompt,
        responseWithCode
      );
      
      const promptSubmitResponse = await promptSubmitHook.process(promptSubmitEvent);
      const postMessageResponse = await postMessageHook.process(postMessageEvent);
      
      // Then: Should handle data transformations consistently (this will fail initially)
      expect(promptSubmitResponse.data?.content).toBe('[REDACTED]'); // Sensitive data sanitized
      expect(postMessageResponse.data?.memoryEntry?.artifacts?.codeBlocks).toHaveLength(1);
      expect(postMessageResponse.data?.memoryEntry?.tags).toContain('typescript');
      
      // Both should maintain same context
      expect(promptSubmitResponse.metadata?.workspaceId).toBe(postMessageResponse.metadata?.workspaceId);
    });
  });

  describe('error propagation and recovery', () => {
    it('should isolate errors between hooks', async () => {
      // Given: One hook that fails but others that work
      const originalProcess = preMessageHook.process;
      preMessageHook.process = async () => {
        throw new Error('Pre-message hook failed');
      };
      
      try {
        const userPrompt = 'Error isolation test';
        
        // When: Processing with one failing hook
        const promptSubmitEvent = eventGenerator.createUserPromptSubmitEvent(userPrompt);
        const postMessageEvent = eventGenerator.createAssistantPostMessageEvent(
          userPrompt,
          'Response despite error'
        );
        
        const promptSubmitResponse = await promptSubmitHook.process(promptSubmitEvent);
        
        let preMessageResponse;
        try {
          const preMessageEvent = eventGenerator.createAssistantPreMessageEvent(userPrompt);
          preMessageResponse = await preMessageHook.process(preMessageEvent);
        } catch (error) {
          preMessageResponse = { success: false, error: error.message };
        }
        
        const postMessageResponse = await postMessageHook.process(postMessageEvent);
        
        // Then: Should isolate failures (this will fail initially)
        expect(promptSubmitResponse.success).toBe(true);
        expect(preMessageResponse.success).toBe(false);
        expect(postMessageResponse.success).toBe(true);
      } finally {
        preMessageHook.process = originalProcess;
      }
    });

    it('should provide meaningful error context for debugging', async () => {
      // Given: Hook that throws detailed error
      const originalCreateMemoryEntry = postMessageHook['createMemoryEntry'];
      postMessageHook['createMemoryEntry'] = () => {
        const error = new Error('Memory creation failed');
        error.stack = 'Detailed stack trace for debugging';
        throw error;
      };
      
      try {
        // When: Processing with detailed error
        const event = eventGenerator.createAssistantPostMessageEvent('Error context test', 'Response');
        const response = await postMessageHook.process(event);
        
        // Then: Should provide debugging context (this will fail initially)
        expect(response.success).toBe(false);
        expect(response.error?.code).toBe('POST_MESSAGE_HOOK_ERROR');
        expect(response.error?.message).toBe('Memory creation failed');
        expect(response.error?.details?.error).toBe('Detailed stack trace for debugging');
      } finally {
        postMessageHook['createMemoryEntry'] = originalCreateMemoryEntry;
      }
    });
  });
});