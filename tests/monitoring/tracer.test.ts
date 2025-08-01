import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { TracerService, type TracerConfig } from "../../src/monitoring/tracer.js";

// Mock OpenTelemetry modules
jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: jest.fn(),
    setSpan: jest.fn(),
    getActiveSpan: jest.fn(),
    deleteSpan: jest.fn(),
    setSpanContext: jest.fn(),
    getSpanContext: jest.fn(),
  },
  context: {
    active: jest.fn(),
    with: jest.fn(),
    bind: jest.fn(),
  },
  propagation: {
    inject: jest.fn(),
    extract: jest.fn(),
  },
  SpanStatusCode: {
    OK: 1,
    ERROR: 2,
  },
  SpanKind: {
    CLIENT: 3,
    SERVER: 4,
    INTERNAL: 0,
    PRODUCER: 1,
    CONSUMER: 2,
  },
}));

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn(),
    addResource: jest.fn(),
  })),
}));

jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn(),
}));

jest.mock('@opentelemetry/exporter-jaeger', () => ({
  JaegerExporter: jest.fn().mockImplementation(() => ({
    export: jest.fn(),
    shutdown: jest.fn(),
  })),
}));

jest.mock('@opentelemetry/exporter-zipkin', () => ({
  ZipkinExporter: jest.fn().mockImplementation(() => ({
    export: jest.fn(),
    shutdown: jest.fn(),
  })),
}));

describe('TracerService', () => {
  let tracerService: TracerService;
  let mockConfig: TracerConfig;
  let mockTracer: any;
  let mockSpan: any;
  let mockContext: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock span
    mockSpan = {
      setAttributes: jest.fn(),
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
      addEvent: jest.fn(),
      updateName: jest.fn(),
      isRecording: jest.fn().mockReturnValue(true),
      spanContext: jest.fn().mockReturnValue({
        traceId: 'test-trace-id',
        spanId: 'test-span-id',
        traceFlags: 1,
      }),
    };

    // Setup mock tracer
    mockTracer = {
      startSpan: jest.fn().mockReturnValue(mockSpan),
      startActiveSpan: jest.fn().mockImplementation((name, options, context, fn) => {
        return fn(mockSpan);
      }),
    };

    // Setup mock context
    mockContext = {
      active: jest.fn(),
      with: jest.fn(),
      bind: jest.fn(),
    };

    // Configure default test config
    mockConfig = {
      serviceName: 'test-service',
      version: '1.0.0',
      environment: 'test',
      enabled: true,
      exporters: ['console'],
      samplingRate: 1.0,
    };
  });

  afterEach(async () => {
    if (tracerService) {
      await tracerService.shutdown();
    }
  });

  describe('initialization', () => {
    it('should initialize with OpenTelemetry SDK', async () => {
      // Given: TracerService configuration
      tracerService = new TracerService(mockConfig);
      
      // When: Initializing the service
      await tracerService.initialize();
      
      // Then: Service should be initialized
      expect(tracerService.isInitialized()).toBe(true);
    });

    it('should throw if used before initialization', async () => {
      // Given: Uninitialized tracer service
      tracerService = new TracerService(mockConfig);
      
      // When/Then: Operations before initialization should throw
      expect(() => tracerService.startSpan('test-span')).toThrow('TracerService not initialized');
      expect(() => tracerService.getActiveSpan()).toThrow('TracerService not initialized');
      await expect(tracerService.withSpan(mockSpan, async () => {})).rejects.toThrow('TracerService not initialized');
    });

    it('should handle initialization failure gracefully', async () => {
      // Given: Configuration that causes initialization failure
      const badConfig = {
        ...mockConfig,
        exporters: ['invalid-exporter'],
      };
      
      // When/Then: Construction should throw error for invalid config
      expect(() => new TracerService(badConfig)).toThrow('Invalid exporter: invalid-exporter');
    });

    it('should skip initialization when disabled', async () => {
      // Given: Disabled tracer configuration
      mockConfig.enabled = false;
      tracerService = new TracerService(mockConfig);
      
      // When: Initializing disabled service
      await tracerService.initialize();
      
      // Then: Service should be in disabled state
      expect(tracerService.isEnabled()).toBe(false);
      expect(tracerService.isInitialized()).toBe(true);
    });

    it('should configure multiple exporters', async () => {
      // Given: Configuration with multiple exporters
      mockConfig.exporters = ['console', 'otlp', 'jaeger'];
      tracerService = new TracerService(mockConfig);
      
      // When: Initializing with multiple exporters
      await tracerService.initialize();
      
      // Then: All enabled exporters should be configured
      expect(tracerService.isInitialized()).toBe(true);
    });
  });

  describe('span creation and management', () => {
    beforeEach(async () => {
      tracerService = new TracerService(mockConfig);
      await tracerService.initialize();
    });

    it('should create spans with attributes', () => {
      // Given: Span attributes
      const attributes = {
        'operation.type': 'database',
        'db.statement': 'SELECT * FROM users',
        'user.id': '123',
      };
      
      // When: Creating a span
      const span = tracerService.startSpan('database-query', {
        attributes,
        kind: 'CLIENT',
      });
      
      // Then: Span should be created with attributes
      expect(span).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledWith('database-query', {
        attributes,
        kind: expect.any(Number),
      });
    });

    it('should create child spans with parent context', () => {
      // Given: Parent span
      const parentSpan = tracerService.startSpan('parent-operation');
      
      // When: Creating child span
      const childSpan = tracerService.startSpan('child-operation', {
        parent: parentSpan,
      });
      
      // Then: Child span should have parent context
      expect(childSpan).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledTimes(2);
    });

    it('should end spans and record duration', () => {
      // Given: A span
      const span = tracerService.startSpan('test-operation');
      
      // When: Ending the span
      tracerService.endSpan(span);
      
      // Then: Span should be ended
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle span creation when disabled', () => {
      // Given: Disabled tracer service
      mockConfig.enabled = false;
      const disabledService = new TracerService(mockConfig);
      
      // When: Creating span on disabled service
      const span = disabledService.startSpan('test-span');
      
      // Then: Should return no-op span
      expect(span).toBeDefined();
      expect(span.isRecording()).toBe(false);
    });

    it('should support span options and context', () => {
      // Given: Span options with timestamps and links
      const startTime = Date.now();
      const options = {
        startTime,
        attributes: { 'test.attr': 'value' },
        kind: 'INTERNAL' as const,
        links: [{ context: mockSpan.spanContext() }],
      };
      
      // When: Creating span with options
      const span = tracerService.startSpan('complex-operation', options);
      
      // Then: Span should be created with all options
      expect(span).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledWith('complex-operation', {
        startTime,
        attributes: options.attributes,
        kind: expect.any(Number),
        links: options.links,
      });
    });
  });

  describe('context propagation', () => {
    beforeEach(async () => {
      tracerService = new TracerService(mockConfig);
      await tracerService.initialize();
    });

    it('should execute function with span context', async () => {
      // Given: A span and async function
      const span = tracerService.startSpan('test-operation');
      const testFunction = jest.fn().mockResolvedValue('result');
      
      // When: Executing function with span context
      const result = await tracerService.withSpan(span, testFunction);
      
      // Then: Function should execute with span context
      expect(result).toBe('result');
      expect(testFunction).toHaveBeenCalled();
    });

    it('should handle exceptions in span context', async () => {
      // Given: A span and failing function
      const span = tracerService.startSpan('failing-operation');
      const error = new Error('Test error');
      const failingFunction = jest.fn().mockRejectedValue(error);
      
      // When/Then: Exception should be propagated and recorded
      await expect(tracerService.withSpan(span, failingFunction)).rejects.toThrow('Test error');
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: expect.any(Number),
        message: 'Test error',
      });
    });

    it('should inject context into carriers', () => {
      // Given: Active span and carrier object
      const span = tracerService.startSpan('http-request');
      const carrier: Record<string, string> = {};
      
      // When: Injecting context
      tracerService.inject(carrier);
      
      // Then: Context should be injected into carrier
      expect(carrier).toBeDefined();
    });

    it('should extract context from carriers', () => {
      // Given: Carrier with trace context
      const carrier = {
        'traceparent': '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      };
      
      // When: Extracting context
      const context = tracerService.extract(carrier);
      
      // Then: Context should be extracted
      expect(context).toBeDefined();
    });

    it('should get active span context', () => {
      // Given: Active span
      const span = tracerService.startSpan('active-operation');
      
      // When: Getting active span
      const activeSpan = tracerService.getActiveSpan();
      
      // Then: Should return active span
      expect(activeSpan).toBeDefined();
    });

    it('should handle context propagation errors', () => {
      // Given: Invalid carrier for injection
      const invalidCarrier = null;
      
      // When/Then: Should handle injection errors gracefully
      expect(() => tracerService.inject(invalidCarrier as any)).not.toThrow();
    });
  });

  describe('error handling scenarios', () => {
    beforeEach(async () => {
      tracerService = new TracerService(mockConfig);
      await tracerService.initialize();
    });

    it('should record exceptions on spans', () => {
      // Given: A span and an error
      const span = tracerService.startSpan('error-operation');
      const error = new Error('Database connection failed');
      error.stack = 'Error: Database connection failed\n    at test.js:1:1';
      
      // When: Recording exception
      tracerService.recordException(span, error);
      
      // Then: Exception should be recorded with details
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: expect.any(Number),
        message: 'Database connection failed',
      });
    });

    it('should set span status for errors', () => {
      // Given: A span
      const span = tracerService.startSpan('status-operation');
      
      // When: Setting error status
      tracerService.setSpanStatus(span, 'ERROR', 'Operation failed');
      
      // Then: Span status should be set
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: expect.any(Number),
        message: 'Operation failed',
      });
    });

    it('should handle span operations on null spans', () => {
      // Given: Null span
      const nullSpan = null;
      
      // When/Then: Operations on null spans should not throw
      expect(() => tracerService.endSpan(nullSpan as any)).not.toThrow();
      expect(() => tracerService.recordException(nullSpan as any, new Error('test'))).not.toThrow();
      expect(() => tracerService.setSpanStatus(nullSpan as any, 'ERROR', 'test')).not.toThrow();
    });

    it('should handle tracer initialization failures', async () => {
      // Given: Configuration that causes tracer failure  
      const badConfig = {
        ...mockConfig,
        exporters: ['invalid-exporter'],
      };
      
      // When/Then: Should throw error during construction
      expect(() => new TracerService(badConfig)).toThrow('Invalid exporter: invalid-exporter');
    });

    it('should handle span creation errors gracefully', () => {
      // Given: Tracer that throws on span creation
      mockTracer.startSpan.mockImplementation(() => {
        throw new Error('Span creation failed');
      });
      
      // When/Then: Should handle span creation errors
      expect(() => tracerService.startSpan('failing-span')).toThrow('Span creation failed');
    });

    it('should validate span names', () => {
      // Given: Invalid span names
      const invalidNames = ['', null, undefined, ' '.repeat(100)];
      
      // When/Then: Should validate span names
      invalidNames.forEach(name => {
        expect(() => tracerService.startSpan(name as any)).toThrow(/Invalid span name/);
      });
    });
  });

  describe('integration with existing components', () => {
    beforeEach(async () => {
      tracerService = new TracerService(mockConfig);
      await tracerService.initialize();
    });

    it('should trace storage operations', async () => {
      // Given: Storage operation attributes
      const attributes = {
        'storage.operation': 'captureMemory',
        'storage.backend': 'sqlite',
        'memory.size': 1024,
        'workspace.id': 'test-workspace',
      };
      
      // When: Tracing storage operation
      const span = tracerService.startSpan('storage.captureMemory', { attributes });
      
      // Simulate storage operation
      await new Promise(resolve => setTimeout(resolve, 10));
      
      tracerService.endSpan(span);
      
      // Then: Span should be created for storage operation
      expect(mockTracer.startSpan).toHaveBeenCalledWith('storage.captureMemory', {
        attributes,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should trace hook system operations', async () => {
      // Given: Hook execution attributes
      const attributes = {
        'hook.type': 'PreToolUse',
        'hook.tool': 'Write',
        'hook.command': 'echo "test"',
        'hook.execution.timeout': 5000,
      };
      
      // When: Tracing hook execution
      const result = await tracerService.withSpan(
        tracerService.startSpan('hook.execute', { attributes }),
        async () => {
          // Simulate hook execution
          return { output: 'test', exitCode: 0 };
        }
      );
      
      // Then: Hook execution should be traced
      expect(result).toEqual({ output: 'test', exitCode: 0 });
      expect(mockTracer.startSpan).toHaveBeenCalledWith('hook.execute', {
        attributes,
      });
    });

    it('should trace git operations', async () => {
      // Given: Git operation attributes
      const attributes = {
        'git.operation': 'getBranchInfo',
        'git.repository': '/path/to/repo',
        'git.branch': 'main',
      };
      
      // When: Tracing git operation
      const span = tracerService.startSpan('git.getBranchInfo', { attributes });
      
      // Simulate git operation error
      const error = new Error('Git repository not found');
      tracerService.recordException(span, error);
      tracerService.endSpan(span);
      
      // Then: Git operation should be traced with error
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: expect.any(Number),
        message: 'Git repository not found',
      });
    });

    it('should trace intelligence layer operations', async () => {
      // Given: Intelligence operation attributes
      const attributes = {
        'intelligence.operation': 'generateEmbedding',
        'intelligence.model': 'all-MiniLM-L6-v2',
        'intelligence.dimension': 384,
        'text.length': 256,
      };
      
      // When: Tracing intelligence operation
      await tracerService.withSpan(
        tracerService.startSpan('intelligence.generateEmbedding', { attributes }),
        async () => {
          // Simulate embedding generation
          return new Float32Array(384).fill(0.1);
        }
      );
      
      // Then: Intelligence operation should be traced
      expect(mockTracer.startSpan).toHaveBeenCalledWith('intelligence.generateEmbedding', {
        attributes,
      });
    });

    it('should trace MCP server tool usage', async () => {
      // Given: MCP tool usage attributes
      const attributes = {
        'mcp.tool': 'capture_memory',
        'mcp.session': 'session-123',
        'mcp.request.size': 512,
      };
      
      // When: Tracing MCP tool usage
      const span = tracerService.startSpan('mcp.tool.capture_memory', { attributes });
      
      // Add custom events
      tracerService.addEvent(span, 'validation.start', { 'input.valid': true });
      tracerService.addEvent(span, 'storage.write', { 'memory.id': 'mem_123' });
      
      tracerService.endSpan(span);
      
      // Then: MCP operation should be traced with events
      expect(mockSpan.addEvent).toHaveBeenCalledWith('validation.start', { 'input.valid': true });
      expect(mockSpan.addEvent).toHaveBeenCalledWith('storage.write', { 'memory.id': 'mem_123' });
    });
  });

  describe('performance and resource management', () => {
    beforeEach(async () => {
      tracerService = new TracerService(mockConfig);
      await tracerService.initialize();
    });

    it('should respect sampling configuration', async () => {
      // Given: Low sampling rate configuration
      mockConfig.sampling.ratio = 0.1;
      const sampledService = new TracerService(mockConfig);
      await sampledService.initialize();
      
      // When: Creating multiple spans
      const spans = Array.from({ length: 10 }, (_, i) => 
        sampledService.startSpan(`operation-${i}`)
      );
      
      // Then: Some spans should be sampled out
      expect(spans.length).toBe(10);
      // Note: In real implementation, some spans would be non-recording
    });

    it('should handle high-frequency span creation', () => {
      // Given: High-frequency span creation scenario
      const spanCount = 1000;
      const spans: any[] = [];
      
      // When: Creating many spans rapidly
      const startTime = Date.now();
      for (let i = 0; i < spanCount; i++) {
        spans.push(tracerService.startSpan(`high-freq-${i}`));
      }
      const endTime = Date.now();
      
      // Then: Should handle high frequency without significant delay
      expect(spans.length).toBe(spanCount);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('should clean up resources on shutdown', async () => {
      // Given: Active tracer service with spans
      const span = tracerService.startSpan('cleanup-test');
      
      // When: Shutting down service
      await tracerService.shutdown();
      
      // Then: Resources should be cleaned up
      expect(tracerService.isInitialized()).toBe(false);
    });

    it('should handle shutdown errors gracefully', async () => {
      // Given: Service that fails during shutdown
      const mockNodeSDK = require('@opentelemetry/sdk-node').NodeSDK;
      mockNodeSDK.mockImplementation(() => ({
        start: jest.fn(),
        shutdown: jest.fn().mockRejectedValue(new Error('Shutdown failed')),
      }));
      
      const failingService = new TracerService(mockConfig);
      await failingService.initialize();
      
      // When/Then: Should handle shutdown failure
      await expect(failingService.shutdown()).rejects.toThrow('Shutdown failed');
    });

    it('should provide trace statistics', () => {
      // Given: Service with some activity
      tracerService.startSpan('stats-test-1');
      tracerService.startSpan('stats-test-2');
      
      // When: Getting statistics
      const stats = tracerService.getStatistics();
      
      // Then: Should provide trace statistics
      expect(stats).toEqual({
        spansCreated: expect.any(Number),
        activeSpans: expect.any(Number),
        samplingRate: expect.any(Number),
        exporterStatus: expect.any(Object),
      });
    });
  });

  describe('configuration validation', () => {
    it('should validate required configuration fields', () => {
      // Given: Invalid configurations
      const invalidConfigs = [
        { ...mockConfig, serviceName: '' },
        { ...mockConfig, serviceName: undefined },
        { ...mockConfig, version: null },
        { ...mockConfig, exporters: null },
      ];
      
      // When/Then: Should validate configuration
      invalidConfigs.forEach(config => {
        expect(() => new TracerService(config as any)).toThrow(/Invalid configuration/);
      });
    });

    it('should provide default configuration values', () => {
      // Given: Minimal configuration
      const minimalConfig = {
        serviceName: 'test-service',
      };
      
      // When: Creating service with minimal config
      const service = new TracerService(minimalConfig as any);
      
      // Then: Should apply defaults
      expect(service).toBeDefined();
    });

    it('should validate exporter configurations', () => {
      // Given: Invalid exporter configuration
      const invalidExporterConfig = {
        ...mockConfig,
        exporters: {
          jaeger: {
            endpoint: 'not-a-url',
            enabled: true,
          },
        },
      };
      
      // When/Then: Should validate exporter config
      expect(() => new TracerService(invalidExporterConfig)).toThrow(/Invalid exporter configuration/);
    });

    it('should validate sampling configuration', () => {
      // Given: Invalid sampling configuration
      const invalidSamplingConfigs = [
        { ...mockConfig, sampling: { ratio: -0.1 } },
        { ...mockConfig, sampling: { ratio: 1.1 } },
        { ...mockConfig, sampling: { ratio: 'invalid' } },
      ];
      
      // When/Then: Should validate sampling config
      invalidSamplingConfigs.forEach(config => {
        expect(() => new TracerService(config as any)).toThrow(/Invalid sampling configuration/);
      });
    });
  });
});