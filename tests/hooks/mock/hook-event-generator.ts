/**
 * Hook event generator for creating test events for different hook types
 */

import { HookEvent } from '../../../src/hooks/templates/base-template.js';
import crypto from 'crypto';

export interface EventGeneratorConfig {
  workspacePath?: string;
  sessionId?: string;
  userId?: string;
  environment?: Record<string, string>;
}

export class HookEventGenerator {
  private config: Required<EventGeneratorConfig>;
  private eventCounter = 0;

  constructor(config: EventGeneratorConfig = {}) {
    this.config = {
      workspacePath: config.workspacePath ?? '/test/workspace',
      sessionId: config.sessionId ?? 'test-session-' + this.generateId(),
      userId: config.userId ?? 'test-user-' + this.generateId(),
      environment: config.environment ?? {
        NODE_ENV: 'test',
        PATH: '/usr/bin:/bin',
        HOME: '/home/testuser',
      },
    };
  }

  /**
   * Generate user prompt submit event
   */
  createUserPromptSubmitEvent(
    prompt: string,
    metadata?: {
      source?: 'chat' | 'command' | 'file' | 'selection';
      filePath?: string;
      lineNumber?: number;
      language?: string;
    }
  ): HookEvent {
    return this.createEvent('user-prompt-submit', {
      prompt,
      timestamp: new Date().toISOString(),
      metadata: metadata || {},
    });
  }

  /**
   * Generate assistant pre-message event
   */
  createAssistantPreMessageEvent(
    userPrompt: string,
    options?: {
      promptId?: string;
      conversationHistory?: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: string;
      }>;
      contextRequested?: boolean;
      maxContextTokens?: number;
    }
  ): HookEvent {
    return this.createEvent('assistant-pre-message', {
      promptId: options?.promptId ?? this.generateId(),
      userPrompt,
      conversationHistory: options?.conversationHistory ?? [],
      contextRequested: options?.contextRequested ?? true,
      maxContextTokens: options?.maxContextTokens ?? 2000,
    });
  }

  /**
   * Generate assistant message chunk event
   */
  createAssistantMessageEvent(
    messageId: string,
    promptId: string,
    chunk: {
      content: string;
      index: number;
      isFirst?: boolean;
      isLast?: boolean;
    },
    options?: {
      messageType?: 'text' | 'code' | 'tool_use' | 'tool_result';
      metadata?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
      };
    }
  ): HookEvent {
    return this.createEvent('assistant-message', {
      messageId,
      promptId,
      chunk,
      messageType: options?.messageType ?? 'text',
      metadata: options?.metadata ?? {},
    });
  }

  /**
   * Generate assistant post-message event
   */
  createAssistantPostMessageEvent(
    userPrompt: string,
    assistantResponse: string,
    options?: {
      messageId?: string;
      promptId?: string;
      conversationId?: string;
      metadata?: {
        model?: string;
        tokensUsed?: number;
        executionTime?: number;
        toolsUsed?: string[];
        filesModified?: string[];
      };
      outcome?: {
        success: boolean;
        errorCount?: number;
        warningCount?: number;
      };
    }
  ): HookEvent {
    return this.createEvent('assistant-post-message', {
      messageId: options?.messageId ?? this.generateId(),
      promptId: options?.promptId ?? this.generateId(),
      userPrompt,
      assistantResponse,
      conversationId: options?.conversationId,
      metadata: options?.metadata ?? {},
      outcome: options?.outcome ?? { success: true },
    });
  }

  /**
   * Generate invalid event for error testing
   */
  createInvalidEvent(invalidations?: {
    missingType?: boolean;
    missingTimestamp?: boolean;
    missingData?: boolean;
    invalidTimestamp?: boolean;
    malformedData?: boolean;
  }): any {
    const base: any = {
      type: 'test-event',
      timestamp: new Date().toISOString(),
      data: { test: 'data' },
      context: this.getBaseContext(),
    };

    if (invalidations?.missingType) {
      delete base.type;
    }
    if (invalidations?.missingTimestamp) {
      delete base.timestamp;
    }
    if (invalidations?.missingData) {
      delete base.data;
    }
    if (invalidations?.invalidTimestamp) {
      base.timestamp = 'invalid-timestamp';
    }
    if (invalidations?.malformedData) {
      base.data = 'not-an-object';
    }

    return base;
  }

  /**
   * Generate large prompt event for stress testing
   */
  createLargePromptEvent(size: number = 150000): HookEvent {
    const largeContent = 'x'.repeat(size);
    return this.createUserPromptSubmitEvent(largeContent);
  }

  /**
   * Generate event with sensitive data for sanitization testing
   */
  createSensitiveDataEvent(): HookEvent {
    return this.createEvent('sensitive-test', {
      apiKey: 'sk-1234567890abcdef',
      password: 'super-secret-password',
      token: 'bearer-token-12345',
      secretKey: 'secret-key-value',
      authToken: 'auth-12345',
      credential: 'credential-data',
      normalData: 'this-is-fine',
      nested: {
        api_key: 'nested-api-key',
        secret: 'nested-secret',
        publicInfo: 'public-information',
      },
    });
  }

  /**
   * Generate conversation history for testing
   */
  createConversationHistory(length: number = 5): Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }> {
    const history = [];
    const now = Date.now();

    for (let i = 0; i < length; i++) {
      const isUser = i % 2 === 0;
      history.push({
        role: isUser ? 'user' as const : 'assistant' as const,
        content: isUser 
          ? `User message ${i + 1}: How do I implement this feature?`
          : `Assistant response ${i + 1}: Here's how you can implement it...`,
        timestamp: new Date(now - (length - i) * 60000).toISOString(),
      });
    }

    return history;
  }

  /**
   * Generate streaming message chunks
   */
  createMessageChunks(fullMessage: string, chunkSize: number = 50): Array<{
    content: string;
    index: number;
    isFirst: boolean;
    isLast: boolean;
  }> {
    const chunks = [];
    const totalLength = fullMessage.length;
    
    for (let i = 0; i < totalLength; i += chunkSize) {
      const content = fullMessage.slice(i, i + chunkSize);
      const index = Math.floor(i / chunkSize);
      
      chunks.push({
        content,
        index,
        isFirst: index === 0,
        isLast: i + chunkSize >= totalLength,
      });
    }

    return chunks;
  }

  /**
   * Generate batch of events for load testing
   */
  createEventBatch(count: number, type: 'prompt' | 'message' | 'mixed' = 'mixed'): HookEvent[] {
    const events = [];
    
    for (let i = 0; i < count; i++) {
      switch (type) {
        case 'prompt':
          events.push(this.createUserPromptSubmitEvent(`Test prompt ${i + 1}`));
          break;
        case 'message':
          events.push(this.createAssistantPostMessageEvent(
            `User prompt ${i + 1}`,
            `Assistant response ${i + 1}`
          ));
          break;
        case 'mixed':
          if (i % 3 === 0) {
            events.push(this.createUserPromptSubmitEvent(`Prompt ${i + 1}`));
          } else if (i % 3 === 1) {
            events.push(this.createAssistantPreMessageEvent(`Pre-message ${i + 1}`));
          } else {
            events.push(this.createAssistantPostMessageEvent(
              `User ${i + 1}`,
              `Assistant ${i + 1}`
            ));
          }
          break;
      }
    }

    return events;
  }

  /**
   * Reset event counter and session
   */
  reset(): void {
    this.eventCounter = 0;
    this.config.sessionId = 'test-session-' + this.generateId();
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<EventGeneratorConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<EventGeneratorConfig>): void {
    Object.assign(this.config, updates);
  }

  /**
   * Create base event structure
   */
  private createEvent(type: string, data: Record<string, unknown>): HookEvent {
    this.eventCounter++;
    
    return {
      type,
      timestamp: new Date().toISOString(),
      data,
      context: this.getBaseContext(),
    };
  }

  /**
   * Get base context for events
   */
  private getBaseContext() {
    return {
      workspacePath: this.config.workspacePath,
      sessionId: this.config.sessionId,
      userId: this.config.userId,
      environment: { ...this.config.environment },
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(length: number = 8): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Get event generation statistics
   */
  getStats() {
    return {
      eventCounter: this.eventCounter,
      config: { ...this.config },
    };
  }
}