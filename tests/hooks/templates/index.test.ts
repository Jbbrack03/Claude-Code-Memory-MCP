/**
 * Index file for hook template tests
 * Exports all template test modules for easy importing
 */

// Template test exports - these will fail initially as the templates don't exist yet
export * from './base-template.test.js';
export * from './user-prompt-submit-hook.test.js';
export * from './user-prompt-assistant-pre-message-hook.test.js';
export * from './user-prompt-assistant-message-hook.test.js';
export * from './user-prompt-assistant-post-message-hook.test.js';