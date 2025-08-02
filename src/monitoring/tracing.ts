import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

export interface TracingConfig {
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  endpoint?: string;
  enableAutoInstrumentation?: boolean;
  disabledInstrumentations?: string[];
}

export function initializeTracing(config: TracingConfig): NodeSDK {
  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: config.serviceVersion || process.env.npm_package_version || '0.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.environment || process.env.NODE_ENV || 'development'
  });
  
  const traceExporter = new OTLPTraceExporter({
    url: config.endpoint || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces'
  });
  
  const instrumentations = config.enableAutoInstrumentation !== false 
    ? getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false // Disable fs instrumentation for performance
        },
        '@opentelemetry/instrumentation-http': {
          enabled: true,
          ignoreIncomingRequestHook: (req) => {
            // Ignore health check and metrics endpoints
            return !!(req.url?.includes('/health') || req.url?.includes('/metrics'));
          }
        },
        ...Object.fromEntries(
          (config.disabledInstrumentations || []).map(name => [name, { enabled: false }])
        )
      })
    : [];
  
  const sdk = new NodeSDK({
    resource,
    spanProcessor: new BatchSpanProcessor(traceExporter, {
      maxQueueSize: 100,
      scheduledDelayMillis: 500,
      maxExportBatchSize: 10
    }),
    instrumentations
  });
  
  return sdk;
}

export function startTracing(config: TracingConfig): NodeSDK {
  const sdk = initializeTracing(config);
  
  try {
    sdk.start();
    // Using console for tracing initialization as this is a development/debug output
    // eslint-disable-next-line no-console
    console.log('OpenTelemetry tracing initialized successfully');
    return sdk;
  } catch (error) {
    // Using console for tracing errors as this is critical startup information
    // eslint-disable-next-line no-console
    console.error('Failed to initialize OpenTelemetry tracing:', error);
    throw error;
  }
}

// Process handlers for graceful shutdown
export function setupTracingShutdown(sdk: NodeSDK): void {
  const shutdown = async () => {
    try {
      // Using console for shutdown messages as this is critical system information
      // eslint-disable-next-line no-console
      console.log('Shutting down OpenTelemetry...');
      await sdk.shutdown();
      // eslint-disable-next-line no-console
      console.log('OpenTelemetry shut down successfully');
      process.exit(0);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error shutting down OpenTelemetry:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}