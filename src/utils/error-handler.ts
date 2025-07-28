import { createLogger } from "./logger.js";

const logger = createLogger("ErrorHandler");

export enum ErrorSeverity {
  CRITICAL = "critical",
  HIGH = "high", 
  MEDIUM = "medium",
  LOW = "low"
}

export interface LogSafeError {
  message: string;
  code?: string;
  severity: ErrorSeverity;
  timestamp: Date;
  context?: Record<string, unknown>;
}

export class ErrorHandler {
  /**
   * Classify error severity based on error type and context
   */
  static classify(error: Error): ErrorSeverity {
    // Critical: System initialization failures, database corruption
    if (error.message.includes('initialization') || 
        error.message.includes('corrupt') ||
        error.message.includes('SQLITE_CORRUPT')) {
      return ErrorSeverity.CRITICAL;
    }
    
    // High: Memory/disk full, network timeouts, permission errors
    if (error.message.includes('ENOSPC') ||
        error.message.includes('EACCES') ||
        error.message.includes('timeout') ||
        error.message.includes('Permission denied')) {
      return ErrorSeverity.HIGH;
    }
    
    // Medium: Hook failures, validation errors
    if (error.message.includes('hook') ||
        error.message.includes('validation') ||
        error.message.includes('Schema')) {
      return ErrorSeverity.MEDIUM;
    }
    
    // Default to low for other errors
    return ErrorSeverity.LOW;
  }

  /**
   * Determine if service should restart based on error
   */
  static shouldRestart(error: Error): boolean {
    const severity = this.classify(error);
    
    // Restart for critical database or initialization errors
    if (severity === ErrorSeverity.CRITICAL) {
      return true;
    }
    
    // Restart for repeated high-severity errors
    if (severity === ErrorSeverity.HIGH && this.isRepeatedError(error)) {
      return true;
    }
    
    return false;
  }

  /**
   * Sanitize error for logging (remove sensitive data)
   */
  static sanitizeForLogging(error: Error, context?: Record<string, unknown>): LogSafeError {
    const severity = this.classify(error);
    
    // Remove sensitive patterns from message
    let message = error.message;
    message = message.replace(/password[=:]\s*\S+/gi, 'password=***');
    message = message.replace(/token[=:]\s*\S+/gi, 'token=***');
    message = message.replace(/key[=:]\s*\S+/gi, 'key=***');
    message = message.replace(/auth[=:]\s*\S+/gi, 'auth=***');
    
    // Sanitize context
    const sanitizedContext = context ? this.sanitizeContext(context) : undefined;
    
    return {
      message,
      code: (error as NodeJS.ErrnoException).code,
      severity,
      timestamp: new Date(),
      context: sanitizedContext
    };
  }

  /**
   * Handle global uncaught exceptions
   */
  static setupGlobalHandlers(): void {
    process.on('uncaughtException', (error: Error) => {
      const sanitized = this.sanitizeForLogging(error, { 
        type: 'uncaughtException' 
      });
      
      logger.error('Uncaught exception', sanitized);
      
      if (this.shouldRestart(error)) {
        logger.error('Restarting process due to critical error');
        process.exit(1);
      }
    });

    process.on('unhandledRejection', (reason: unknown) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      const sanitized = this.sanitizeForLogging(error, { 
        type: 'unhandledRejection' 
      });
      
      logger.error('Unhandled promise rejection', sanitized);
      
      if (this.shouldRestart(error)) {
        logger.error('Restarting process due to critical error');
        process.exit(1);
      }
    });
  }

  /**
   * Check if this is a repeated error (simple implementation)
   */
  private static errorCounts = new Map<string, { count: number; lastSeen: Date }>();
  
  private static isRepeatedError(error: Error): boolean {
    const key = error.message.substring(0, 100); // Use first 100 chars as key
    const now = new Date();
    const entry = this.errorCounts.get(key);
    
    if (!entry) {
      this.errorCounts.set(key, { count: 1, lastSeen: now });
      return false;
    }
    
    // Reset count if last error was more than 5 minutes ago
    if (now.getTime() - entry.lastSeen.getTime() > 5 * 60 * 1000) {
      this.errorCounts.set(key, { count: 1, lastSeen: now });
      return false;
    }
    
    entry.count++;
    entry.lastSeen = now;
    
    // Consider repeated if seen 3+ times in 5 minutes
    return entry.count >= 3;
  }

  /**
   * Sanitize context object to remove sensitive data
   */
  private static sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'token', 'key', 'auth', 'secret', 'credential'];
    
    for (const [key, value] of Object.entries(context)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveKeys.some(sensitive => lowerKey.includes(sensitive));
      
      if (isSensitive) {
        sanitized[key] = '***';
      } else if (typeof value === 'string' && value.length > 500) {
        // Truncate very long strings
        sanitized[key] = value.substring(0, 500) + '... (truncated)';
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }
}