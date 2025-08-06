/**
 * Hook template for capturing user prompt submissions
 * Executes when a user submits a prompt to Claude Code
 */

import { BaseHookTemplate, HookEvent, HookResponse } from './base-template.js';
import { z } from 'zod';

/**
 * Schema for user prompt submit event data
 */
const UserPromptSubmitEventSchema = z.object({
  prompt: z.string(),
  timestamp: z.string(),
  metadata: z.object({
    source: z.enum(['chat', 'command', 'file', 'selection']).optional(),
    filePath: z.string().optional(),
    lineNumber: z.number().optional(),
    language: z.string().optional(),
  }).optional(),
});

export class UserPromptSubmitHook extends BaseHookTemplate {
  constructor() {
    super('user-prompt-submit-hook', {
      timeout: 3000,
      maxRetries: 2,
    });
  }

  process(event: HookEvent): Promise<HookResponse> {
    try {
      // Validate the event
      const validatedEvent = this.validateEvent(event);
      
      // Parse and validate the specific event data
      const eventData = UserPromptSubmitEventSchema.parse(validatedEvent.data);
      
      // Extract context
      const context = this.extractContext(validatedEvent);
      
      // Sanitize the prompt data
      const sanitizedData = this.sanitizeData({
        prompt: eventData.prompt,
        metadata: eventData.metadata,
      });
      
      // Check prompt length limits
      if (eventData.prompt.length > 100000) {
        return Promise.resolve(this.createErrorResponse(
          'PROMPT_TOO_LARGE',
          'User prompt exceeds maximum length of 100,000 characters',
          { actualLength: eventData.prompt.length }
        ));
      }
      
      // Check for empty prompts
      if (eventData.prompt.trim().length === 0) {
        return Promise.resolve(this.createErrorResponse(
          'EMPTY_PROMPT',
          'User prompt cannot be empty'
        ));
      }
      
      // Prepare memory capture data
      const memoryData = {
        type: 'user_prompt',
        content: sanitizedData.prompt as string,
        metadata: {
          ...(sanitizedData.metadata as Record<string, unknown>),
          source: eventData.metadata?.source ?? 'chat',
          timestamp: eventData.timestamp,
        },
        capture: true,
        indexing: {
          enabled: true,
          priority: 'high',
        },
      };
      
      return Promise.resolve(this.createSuccessResponse(memoryData, context));
      
    } catch (error) {
      return Promise.resolve(this.createErrorResponse(
        'HOOK_PROCESSING_ERROR',
        error instanceof Error ? error.message : 'Failed to process user prompt submit event',
        { error: error instanceof Error ? error.stack : undefined }
      ));
    }
  }
}

/**
 * Factory function to create hook instance
 */
export function createUserPromptSubmitHook(): UserPromptSubmitHook {
  return new UserPromptSubmitHook();
}