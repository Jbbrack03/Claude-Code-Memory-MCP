import { NodeSDK } from '@opentelemetry/sdk-node';
import { trace, Tracer, Span, SpanKind, SpanStatusCode, context, Context, propagation } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TracerService');

export interface TracerConfig {
  serviceName: string;
  enabled?: boolean;
  endpoint?: string;
  exporters?: Array<'otlp' | 'console' | 'jaeger' | 'zipkin'>;
  samplingRate?: number;
  environment?: string;
  version?: string;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, any>;
  parent?: Span;
}

export interface TraceStatistics {
  spansCreated: number;
  spansEnded: number;
  activeSpans: number;
  errors: number;
}

export class TracerService {
  private config: TracerConfig;
  private sdk?: NodeSDK;
  private tracer?: Tracer;
  private initialized: boolean = false;
  private enabled: boolean;
  private statistics: TraceStatistics = {
    spansCreated: 0,
    spansEnded: 0,
    activeSpans: 0,
    errors: 0
  };
  private activeSpans: Set<Span> = new Set();

  constructor(config: TracerConfig) {
    this.validateConfig(config);
    this.config = {
      ...config,
      enabled: config.enabled ?? true,
      exporters: config.exporters || ['console'],
      samplingRate: config.samplingRate ?? 1.0,
      environment: config.environment || 'development',
      version: config.version || '0.0.0'
    };
    this.enabled = this.config.enabled;
  }

  private validateConfig(config: TracerConfig): void {
    if (!config) {
      throw new Error('TracerService config is required');
    }
    if (!config.serviceName) {
      throw new Error('TracerService config.serviceName is required');
    }
    if (config.samplingRate !== undefined && (config.samplingRate < 0 || config.samplingRate > 1)) {
      throw new Error('TracerService config.samplingRate must be between 0 and 1');
    }
    if (config.exporters) {
      const validExporters = ['otlp', 'console', 'jaeger', 'zipkin'];
      const exportersArray = Array.isArray(config.exporters) ? config.exporters : [config.exporters];
      for (const exporter of exportersArray) {
        if (!validExporters.includes(exporter)) {
          throw new Error(`Invalid exporter: ${exporter}`);
        }
      }
    }
  }

  async initialize(): Promise<void> {
    if (!this.enabled) {
      logger.debug('TracerService is disabled, skipping initialization');
      this.initialized = true; // Mark as initialized even when disabled
      return;
    }

    if (this.initialized) {
      return;
    }

    try {
      const resource = new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: this.config.version!,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment!
      });

      const spanProcessors = this.createSpanProcessors();

      this.sdk = new NodeSDK({
        resource,
        spanProcessors,
        instrumentations: [
          getNodeAutoInstrumentations({
            '@opentelemetry/instrumentation-fs': {
              enabled: false // Disable fs instrumentation for performance
            }
          })
        ]
      });

      await this.sdk.start();
      this.tracer = trace.getTracer(this.config.serviceName, this.config.version);
      this.initialized = true;
      logger.info('TracerService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize TracerService', error);
      throw error;
    }
  }

  private createSpanProcessors(): BatchSpanProcessor[] {
    const processors: BatchSpanProcessor[] = [];
    const exporters = this.config.exporters || ['console'];

    for (const exporterType of exporters) {
      switch (exporterType) {
        case 'otlp':
          processors.push(new BatchSpanProcessor(new OTLPTraceExporter({
            url: this.config.endpoint || 'http://localhost:4318/v1/traces'
          })));
          break;
        case 'console':
          processors.push(new BatchSpanProcessor(new ConsoleSpanExporter()));
          break;
        case 'jaeger':
          processors.push(new BatchSpanProcessor(new JaegerExporter({
            endpoint: this.config.endpoint || 'http://localhost:14268/api/traces'
          })));
          break;
        case 'zipkin':
          processors.push(new BatchSpanProcessor(new ZipkinExporter({
            url: this.config.endpoint || 'http://localhost:9411/api/v2/spans'
          })));
          break;
      }
    }

    return processors;
  }

  async shutdown(): Promise<void> {
    if (!this.sdk) {
      return;
    }

    try {
      await this.sdk.shutdown();
      this.initialized = false;
      this.activeSpans.clear();
      logger.info('TracerService shut down successfully');
    } catch (error) {
      logger.error('Failed to shut down TracerService', error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  startSpan(name: string, options?: SpanOptions): Span {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Span name is required and must be a non-empty string');
    }

    if (!this.initialized) {
      throw new Error('TracerService not initialized');
    }

    if (!this.enabled) {
      // Return a no-op span when disabled but initialized
      const noOpSpan = trace.getTracer('noop').startSpan('noop');
      noOpSpan.end();
      return noOpSpan;
    }

    try {
      const spanOptions: any = {
        kind: options?.kind || SpanKind.INTERNAL
      };

      if (options?.attributes) {
        spanOptions.attributes = options.attributes;
      }

      let span: Span;
      if (options?.parent) {
        const ctx = trace.setSpan(context.active(), options.parent);
        span = this.tracer!.startSpan(name, spanOptions, ctx);
      } else {
        span = this.tracer!.startSpan(name, spanOptions);
      }

      this.activeSpans.add(span);
      this.statistics.spansCreated++;
      this.statistics.activeSpans = this.activeSpans.size;

      return span;
    } catch (error) {
      this.statistics.errors++;
      logger.error('Failed to start span', error);
      // Return a no-op span on error
      const noOpSpan = trace.getTracer('noop').startSpan('noop');
      noOpSpan.end();
      return noOpSpan;
    }
  }

  endSpan(span: Span): void {
    if (!span) {
      logger.warn('Cannot end null span');
      return;
    }

    try {
      span.end();
      this.activeSpans.delete(span);
      this.statistics.spansEnded++;
      this.statistics.activeSpans = this.activeSpans.size;
    } catch (error) {
      this.statistics.errors++;
      logger.error('Failed to end span', error);
    }
  }

  async withSpan<T>(span: Span, fn: () => Promise<T>): Promise<T> {
    if (!this.initialized) {
      throw new Error('TracerService not initialized');
    }

    if (!this.enabled) {
      return fn();
    }

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const result = await fn();
        this.setSpanStatus(span, 'OK');
        return result;
      } catch (error) {
        this.recordException(span, error as Error);
        this.setSpanStatus(span, 'ERROR', (error as Error).message);
        throw error;
      } finally {
        this.endSpan(span);
      }
    });
  }

  getActiveSpan(): Span | null {
    if (!this.initialized) {
      throw new Error('TracerService not initialized');
    }

    if (!this.enabled) {
      return null;
    }

    const activeSpan = trace.getActiveSpan();
    return activeSpan || null;
  }

  inject(carrier: Record<string, string>): void {
    if (!this.initialized || !this.enabled) {
      return;
    }

    try {
      propagation.inject(context.active(), carrier);
    } catch (error) {
      logger.error('Failed to inject context', error);
    }
  }

  extract(carrier: Record<string, string>): Context {
    if (!this.initialized || !this.enabled) {
      return context.active();
    }

    try {
      return propagation.extract(context.active(), carrier);
    } catch (error) {
      logger.error('Failed to extract context', error);
      return context.active();
    }
  }

  recordException(span: Span, error: Error): void {
    if (!span || !error) {
      logger.warn('Cannot record exception: span or error is null');
      return;
    }

    try {
      span.recordException(error);
      span.setAttributes({
        'error': true,
        'error.type': error.name,
        'error.message': error.message
      });
    } catch (e) {
      logger.error('Failed to record exception', e);
    }
  }

  setSpanStatus(span: Span, status: 'OK' | 'ERROR', message?: string): void {
    if (!span) {
      logger.warn('Cannot set status: span is null');
      return;
    }

    try {
      const code = status === 'OK' ? SpanStatusCode.OK : SpanStatusCode.ERROR;
      span.setStatus({ code, message });
    } catch (error) {
      logger.error('Failed to set span status', error);
    }
  }

  addEvent(span: Span, name: string, attributes?: Record<string, any>): void {
    if (!span) {
      logger.warn('Cannot add event: span is null');
      return;
    }

    try {
      span.addEvent(name, attributes);
    } catch (error) {
      logger.error('Failed to add event to span', error);
    }
  }

  getStatistics(): TraceStatistics {
    return { ...this.statistics };
  }
}