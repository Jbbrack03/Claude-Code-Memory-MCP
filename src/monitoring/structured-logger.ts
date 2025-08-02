import winston from 'winston';
import { trace } from '@opentelemetry/api';

export interface LogContext {
  traceId?: string;
  spanId?: string;
  userId?: string;
  workspaceId?: string;
  requestId?: string;
  [key: string]: unknown;
}

export class StructuredLogger {
  private logger: winston.Logger;
  
  constructor(private module: string) {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
          const logEntry = {
            timestamp,
            level,
            message,
            module,
            ...meta
          };
          return JSON.stringify(logEntry);
        })
      ),
      defaultMeta: { module },
      transports: [
        new winston.transports.Console({
          format: process.env.NODE_ENV === 'development' 
            ? winston.format.combine(
                winston.format.colorize(),
                winston.format.simple(),
                winston.format.printf(({ timestamp, level, message, module, traceId, _spanId, ...meta }) => {
                  const trace = traceId && typeof traceId === 'string' ? `[${String(traceId).slice(0, 8)}]` : '';
                  const metaStr = Object.keys(meta || {}).length > 0 ? ` ${JSON.stringify(meta)}` : '';
                  return `${String(timestamp)} ${String(level)} [${String(module)}]${trace}: ${String(message)}${metaStr}`;
                })
              )
            : winston.format.json()
        })
      ]
    });
    
    // Add file transport in production
    if (process.env.NODE_ENV === 'production') {
      this.logger.add(new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: winston.format.json()
      }));
      
      this.logger.add(new winston.transports.File({
        filename: 'logs/combined.log',
        format: winston.format.json()
      }));
    }
  }
  
  private enrichWithTrace(context: LogContext = {}): LogContext {
    const span = trace.getActiveSpan();
    if (span) {
      const spanContext = span.spanContext();
      context.traceId = spanContext.traceId;
      context.spanId = spanContext.spanId;
    }
    return context;
  }
  
  info(message: string, context?: LogContext): void {
    this.logger.info(message, this.enrichWithTrace(context));
  }
  
  error(message: string, error?: Error, context?: LogContext): void {
    const enrichedContext = this.enrichWithTrace(context);
    
    if (error) {
      enrichedContext.error = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };
    }
    
    this.logger.error(message, enrichedContext);
  }
  
  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, this.enrichWithTrace(context));
  }
  
  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, this.enrichWithTrace(context));
  }
  
  verbose(message: string, context?: LogContext): void {
    this.logger.verbose(message, this.enrichWithTrace(context));
  }
  
  // Specialized logging methods for common operations
  logMemoryOperation(
    operation: 'capture' | 'retrieve' | 'build_context',
    status: 'start' | 'success' | 'error',
    context: {
      workspaceId?: string;
      eventType?: string;
      query?: string;
      duration?: number;
      error?: Error;
    } = {}
  ): void {
    const message = `Memory ${operation} ${status}`;
    const logContext: LogContext = {
      operation: `memory.${operation}`,
      status,
      ...context
    };
    
    if (status === 'error' && context.error) {
      this.error(message, context.error, logContext);
    } else if (status === 'start') {
      this.debug(message, logContext);
    } else {
      this.info(message, logContext);
    }
  }
  
  logStorageOperation(
    operation: string,
    storageType: string,
    status: 'start' | 'success' | 'error',
    context: {
      duration?: number;
      recordCount?: number;
      error?: Error;
    } = {}
  ): void {
    const message = `Storage ${operation} on ${storageType} ${status}`;
    const logContext: LogContext = {
      operation: `storage.${operation}`,
      storage_type: storageType,
      status,
      ...context
    };
    
    if (status === 'error' && context.error) {
      this.error(message, context.error, logContext);
    } else if (status === 'start') {
      this.debug(message, logContext);
    } else {
      this.info(message, logContext);
    }
  }
  
  logHookExecution(
    hookType: string,
    command: string,
    status: 'start' | 'success' | 'error',
    context: {
      duration?: number;
      exitCode?: number;
      error?: Error;
    } = {}
  ): void {
    const message = `Hook ${hookType} execution ${status}`;
    const logContext: LogContext = {
      operation: 'hook.execute',
      hook_type: hookType,
      command,
      status,
      ...context
    };
    
    if (status === 'error' && context.error) {
      this.error(message, context.error, logContext);
    } else if (status === 'start') {
      this.debug(message, logContext);
    } else {
      this.info(message, logContext);
    }
  }
  
  logCacheOperation(
    operation: 'hit' | 'miss' | 'set' | 'evict',
    cacheLevel: string,
    key: string,
    context: {
      size?: number;
      ttl?: number;
    } = {}
  ): void {
    const message = `Cache ${operation} on ${cacheLevel}`;
    const logContext: LogContext = {
      operation: `cache.${operation}`,
      cache_level: cacheLevel,
      cache_key: key,
      ...context
    };
    
    this.debug(message, logContext);
  }
  
  logRateLimitEvent(
    endpoint: string,
    workspaceId: string,
    action: 'allowed' | 'exceeded',
    context: {
      remaining?: number;
      resetAfter?: number;
      retryAfter?: number;
    } = {}
  ): void {
    const message = `Rate limit ${action} for ${endpoint}`;
    const logContext: LogContext = {
      operation: 'rate_limit.check',
      endpoint,
      workspace_id: workspaceId,
      action,
      ...context
    };
    
    if (action === 'exceeded') {
      this.warn(message, logContext);
    } else {
      this.debug(message, logContext);
    }
  }
  
  logCircuitBreakerEvent(
    breakerName: string,
    event: 'opened' | 'closed' | 'half_opened' | 'trip',
    context: {
      errorRate?: number;
      threshold?: number;
      failures?: number;
    } = {}
  ): void {
    const message = `Circuit breaker ${breakerName} ${event}`;
    const logContext: LogContext = {
      operation: 'circuit_breaker.event',
      breaker_name: breakerName,
      event,
      ...context
    };
    
    if (event === 'opened' || event === 'trip') {
      this.warn(message, logContext);
    } else {
      this.info(message, logContext);
    }
  }
  
  logSystemEvent(
    event: 'startup' | 'shutdown' | 'health_check',
    status: 'start' | 'success' | 'error',
    context: LogContext = {}
  ): void {
    const message = `System ${event} ${status}`;
    const logContext: LogContext = {
      operation: `system.${event}`,
      status,
      ...context
    };
    
    if (status === 'error') {
      this.error(message, undefined, logContext);
    } else {
      this.info(message, logContext);
    }
  }
  
  // Performance logging
  logPerformanceMetric(
    operation: string,
    duration: number,
    context: LogContext = {}
  ): void {
    if (duration > 1000) { // Log slow operations (>1s)
      this.warn(`Slow operation detected: ${operation}`, {
        ...context,
        duration,
        performance_issue: 'slow_operation'
      });
    } else if (duration > 100) { // Log medium operations (>100ms)
      this.debug(`Operation completed: ${operation}`, {
        ...context,
        duration
      });
    }
  }
  
  // Create child logger with additional context
  child(additionalContext: LogContext): StructuredLogger {
    const childLogger = new StructuredLogger(this.module);
    
    // Override the enrichWithTrace method to include additional context
    const originalEnrich = childLogger.enrichWithTrace.bind(childLogger);
    childLogger.enrichWithTrace = (context: LogContext = {}) => {
      return originalEnrich({ ...additionalContext, ...context });
    };
    
    return childLogger;
  }
}