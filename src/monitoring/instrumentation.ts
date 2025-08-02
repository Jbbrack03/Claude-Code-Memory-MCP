import { trace, SpanStatusCode, SpanKind, Span, AttributeValue } from '@opentelemetry/api';

export class Instrumentation {
  private tracer = trace.getTracer('claude-memory-mcp');
  
  async traceOperation<T>(
    operationName: string,
    attributes: Record<string, AttributeValue>,
    operation: () => Promise<T>
  ): Promise<T> {
    const span = this.tracer.startSpan(operationName, {
      kind: SpanKind.INTERNAL,
      attributes
    });
    
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }
  
  traceSync<T>(
    operationName: string,
    attributes: Record<string, AttributeValue>,
    operation: () => T
  ): T {
    const span = this.tracer.startSpan(operationName, {
      kind: SpanKind.INTERNAL,
      attributes
    });
    
    try {
      const result = operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }
  
  // Create a child span within the current context
  createSpan(name: string, attributes?: Record<string, AttributeValue>): Span {
    return this.tracer.startSpan(name, {
      kind: SpanKind.INTERNAL,
      attributes
    });
  }
  
  // Trace memory operations
  async traceMemoryCapture<T>(
    eventType: string,
    workspaceId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.traceOperation(
      'memory.capture',
      {
        'memory.event_type': eventType,
        'memory.workspace_id': workspaceId
      },
      operation
    );
  }
  
  async traceMemoryRetrieval<T>(
    query: string,
    workspaceId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.traceOperation(
      'memory.retrieve',
      {
        'memory.query': query,
        'memory.workspace_id': workspaceId
      },
      operation
    );
  }
  
  async traceContextBuild<T>(
    query: string,
    workspaceId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.traceOperation(
      'memory.build_context',
      {
        'memory.query': query,
        'memory.workspace_id': workspaceId
      },
      operation
    );
  }
  
  // Trace storage operations
  async traceStorageOperation<T>(
    operationType: string,
    storageType: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.traceOperation(
      `storage.${operationType}`,
      {
        'storage.type': storageType,
        'storage.operation': operationType
      },
      operation
    );
  }
  
  // Trace embedding operations
  async traceEmbeddingGeneration<T>(
    model: string,
    inputSize: number,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.traceOperation(
      'embedding.generate',
      {
        'embedding.model': model,
        'embedding.input_size': inputSize
      },
      operation
    );
  }
  
  // Trace hook operations
  async traceHookExecution<T>(
    hookType: string,
    command: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.traceOperation(
      'hook.execute',
      {
        'hook.type': hookType,
        'hook.command': command
      },
      operation
    );
  }
  
  // Trace query operations
  async traceQueryExecution<T>(
    queryType: string,
    complexity: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.traceOperation(
      'query.execute',
      {
        'query.type': queryType,
        'query.complexity': complexity
      },
      operation
    );
  }
  
  // Add attributes to current span
  addAttributes(attributes: Record<string, AttributeValue>): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes(attributes);
    }
  }
  
  // Add single attribute to current span
  addAttribute(key: string, value: AttributeValue): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute(key, value);
    }
  }
  
  // Record an event on current span
  addEvent(name: string, attributes?: Record<string, AttributeValue>): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.addEvent(name, attributes);
    }
  }
  
  // Record an error on current span
  recordError(error: Error): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
    }
  }
  
  // Get current trace ID for logging correlation
  getCurrentTraceId(): string | undefined {
    const span = trace.getActiveSpan();
    if (span) {
      const spanContext = span.spanContext();
      return spanContext.traceId;
    }
    return undefined;
  }
  
  // Get current span ID for logging correlation
  getCurrentSpanId(): string | undefined {
    const span = trace.getActiveSpan();
    if (span) {
      const spanContext = span.spanContext();
      return spanContext.spanId;
    }
    return undefined;
  }
}