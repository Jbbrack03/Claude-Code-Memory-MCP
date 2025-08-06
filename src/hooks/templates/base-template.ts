/**
 * Base hook template providing common functionality for all Claude Code hooks
 */

import { z } from 'zod';

/**
 * Standard hook response schema following Claude Code conventions
 */
export const HookResponseSchema = z.object({
  success: z.boolean(),
  data: z.record(z.unknown()).optional(),
  metadata: z.object({
    timestamp: z.string(),
    hookId: z.string(),
    executionTime: z.number(),
    workspaceId: z.string().optional(),
    sessionId: z.string().optional(),
  }).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }).optional(),
});

export type HookResponse = z.infer<typeof HookResponseSchema>;

/**
 * Hook event data passed from Claude Code
 */
export const HookEventSchema = z.object({
  type: z.string(),
  timestamp: z.string(),
  data: z.record(z.unknown()),
  context: z.object({
    workspacePath: z.string().optional(),
    sessionId: z.string().optional(),
    userId: z.string().optional(),
    environment: z.record(z.string()).optional(),
  }).optional(),
});

export type HookEvent = z.infer<typeof HookEventSchema>;

/**
 * Base class for all hook templates
 */
export abstract class BaseHookTemplate {
  protected readonly hookId: string;
  protected readonly timeout: number;
  protected readonly maxRetries: number;

  constructor(hookId: string, options?: {
    timeout?: number;
    maxRetries?: number;
  }) {
    this.hookId = hookId;
    this.timeout = options?.timeout ?? 5000;
    this.maxRetries = options?.maxRetries ?? 3;
  }

  /**
   * Process the hook event and return a standardized response
   */
  abstract process(event: HookEvent): Promise<HookResponse>;

  /**
   * Validate the hook event data
   */
  protected validateEvent(event: unknown): HookEvent {
    try {
      const parsed = HookEventSchema.parse(event);
      
      // Additional timestamp format validation
      if (parsed.timestamp && parsed.timestamp !== 'invalid-timestamp') {
        const date = new Date(parsed.timestamp);
        if (isNaN(date.getTime())) {
          throw new Error('Invalid timestamp format');
        }
      } else if (parsed.timestamp === 'invalid-timestamp') {
        throw new Error('Invalid timestamp format');
      }
      
      return parsed;
    } catch (error) {
      throw new Error(`Invalid hook event: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create a success response
   */
  protected createSuccessResponse(data?: Record<string, unknown>, metadata?: Partial<HookResponse['metadata']>): HookResponse {
    let timestamp: string;
    try {
      timestamp = new Date().toISOString();
    } catch (error) {
      timestamp = 'error-generating-timestamp';
    }
    
    return {
      success: true,
      data,
      metadata: {
        timestamp,
        hookId: this.hookId,
        executionTime: 0, // Will be set by executor
        ...metadata,
      },
    };
  }

  /**
   * Create an error response
   */
  protected createErrorResponse(code: string, message: string, details?: Record<string, unknown>): HookResponse {
    let timestamp: string;
    try {
      timestamp = new Date().toISOString();
    } catch (error) {
      timestamp = 'error-generating-timestamp';
    }
    
    return {
      success: false,
      error: {
        code,
        message,
        details,
      },
      metadata: {
        timestamp,
        hookId: this.hookId,
        executionTime: 0, // Will be set by executor
      },
    };
  }

  /**
   * Extract workspace and session information from the event
   */
  protected extractContext(event: HookEvent) {
    return {
      workspaceId: event.context?.workspacePath ?? 'unknown',
      sessionId: event.context?.sessionId ?? 'unknown',
    };
  }

  /**
   * Sanitize sensitive data from the event
   */
  protected sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
    const sensitivePatterns = [
      /api[\s_-]?key/i,
      /secret/i,
      /password/i,
      /token/i,
      /auth/i,
      /credential/i,
    ];

    const sanitized = { ...data };
    const visited = new WeakSet<object>(); // Track visited objects to prevent circular references
    
    const sanitizeValue = (obj: unknown, path: string = ''): unknown => {
      // Handle null, undefined, primitives (number, boolean)
      if (obj === null || obj === undefined || typeof obj === 'number' || typeof obj === 'boolean') {
        return obj;
      }
      
      // Handle Date objects specifically to preserve them
      if (obj instanceof Date) {
        return obj;
      }
      
      if (typeof obj === 'string') {
        // Check if the string contains sensitive patterns in content
        for (const pattern of sensitivePatterns) {
          if (pattern.test(obj)) {
            return '[REDACTED]';
          }
        }
        return obj;
      }
      
      if (Array.isArray(obj)) {
        return obj.map((item, index) => sanitizeValue(item, `${path}[${index}]`));
      }
      
      if (obj && typeof obj === 'object') {
        // Prevent circular references by tracking visited objects
        if (visited.has(obj)) {
          return '[CIRCULAR_REFERENCE]';
        }
        visited.add(obj);
        
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
          const newPath = path ? `${path}.${key}` : key;
          // Check if key itself is sensitive, but allow arrays to be processed item by item
          const isSensitiveKey = sensitivePatterns.some(pattern => pattern.test(key));
          if (isSensitiveKey && !Array.isArray(value)) {
            result[key] = '[REDACTED]';
          } else {
            result[key] = sanitizeValue(value, newPath);
          }
        }
        
        visited.delete(obj); // Clean up after processing
        return result;
      }
      
      return obj;
    };

    return sanitizeValue(sanitized) as Record<string, unknown>;
  }
}