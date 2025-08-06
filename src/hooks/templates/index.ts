/**
 * Hook templates for Claude Code integration
 * 
 * These templates provide standardized implementations for Claude Code hooks
 * that capture events, inject context, and manage memory storage.
 */

export { BaseHookTemplate, HookResponseSchema, HookEventSchema } from './base-template.js';
export type { HookResponse, HookEvent } from './base-template.js';
export { UserPromptSubmitHook, createUserPromptSubmitHook } from './user-prompt-submit-hook.js';
export { UserPromptAssistantPreMessageHook, createUserPromptAssistantPreMessageHook } from './user-prompt-assistant-pre-message-hook.js';
export { UserPromptAssistantMessageHook, createUserPromptAssistantMessageHook } from './user-prompt-assistant-message-hook.js';
export { UserPromptAssistantPostMessageHook, createUserPromptAssistantPostMessageHook } from './user-prompt-assistant-post-message-hook.js';

// Import classes for type safety
import { BaseHookTemplate } from './base-template.js';
import { UserPromptSubmitHook } from './user-prompt-submit-hook.js';
import { UserPromptAssistantPreMessageHook } from './user-prompt-assistant-pre-message-hook.js';
import { UserPromptAssistantMessageHook } from './user-prompt-assistant-message-hook.js';
import { UserPromptAssistantPostMessageHook } from './user-prompt-assistant-post-message-hook.js';

/**
 * Hook type definitions for type safety
 */
export type HookType = 
  | 'user-prompt-submit-hook'
  | 'user-prompt-assistant-pre-message-hook'
  | 'user-prompt-assistant-message-hook'
  | 'user-prompt-assistant-post-message-hook';

/**
 * Hook factory to create instances by type
 */
export function createHookByType(type: HookType): BaseHookTemplate {
  switch (type) {
    case 'user-prompt-submit-hook':
      return new UserPromptSubmitHook();
    case 'user-prompt-assistant-pre-message-hook':
      return new UserPromptAssistantPreMessageHook();
    case 'user-prompt-assistant-message-hook':
      return new UserPromptAssistantMessageHook();
    case 'user-prompt-assistant-post-message-hook':
      return new UserPromptAssistantPostMessageHook();
    default:
      // This should never happen with proper TypeScript checking, but handle it gracefully
      throw new Error(`Unknown hook type: ${String(type)}`);
  }
}

/**
 * Hook execution order for Claude Code integration
 * 
 * 1. user-prompt-submit-hook: Captures user input
 * 2. user-prompt-assistant-pre-message-hook: Injects context before generation
 * 3. user-prompt-assistant-message-hook: Captures streaming response chunks
 * 4. user-prompt-assistant-post-message-hook: Stores complete conversation
 */
export const HOOK_EXECUTION_ORDER: HookType[] = [
  'user-prompt-submit-hook',
  'user-prompt-assistant-pre-message-hook',
  'user-prompt-assistant-message-hook',
  'user-prompt-assistant-post-message-hook',
];

/**
 * Hook configuration defaults
 */
export const HOOK_DEFAULTS = {
  timeout: 5000,
  maxRetries: 3,
  bufferSize: 1024 * 1024, // 1MB
  maxContextTokens: 2000,
  qualityThreshold: 0.5,
} as const;