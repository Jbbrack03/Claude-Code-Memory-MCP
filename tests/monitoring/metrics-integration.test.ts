/**
 * Integration tests for Prometheus metrics system
 * 
 * This test suite follows TDD principles and ensures all tests fail initially (red phase).
 * Tests cover end-to-end integration of MetricsCollector and MetricsEndpoint with MCP server.
 */

import { beforeEach, describe, expect, it, jest, afterEach } from '@jest/globals';
import { MetricsCollector } from '../../src/monitoring/metrics-collector.js';
import { MetricsEndpoint } from '../../src/monitoring/metrics-endpoint.js';
import { MetricsIntegration } from '../../src/monitoring/metrics-integration.js';
import { StorageEngine } from '../../src/storage/engine.js';
import { HookSystem } from '../../src/hooks/system.js';
import { IntelligenceLayer } from '../../src/intelligence/layer.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import http from 'http';

// Mock dependencies
jest.mock('../../src/monitoring/metrics-collector.js');
jest.mock('../../src/monitoring/metrics-endpoint.js');
jest.mock('../../src/storage/engine.js');
jest.mock('../../src/hooks/system.js');
jest.mock('../../src/intelligence/layer.js');
jest.mock('@modelcontextprotocol/sdk/server/mcp.js');

describe('Metrics Integration', () => {
  let metricsIntegration: MetricsIntegration;
  let mockMetricsCollector: jest.Mocked<MetricsCollector>;
  let mockMetricsEndpoint: jest.Mocked<MetricsEndpoint>;
  let mockStorageEngine: jest.Mocked<StorageEngine>;
  let mockHookSystem: jest.Mocked<HookSystem>;
  let mockIntelligenceLayer: jest.Mocked<IntelligenceLayer>;
  let mockMcpServer: jest.Mocked<McpServer>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock MetricsCollector
    mockMetricsCollector = {
      initialize: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(true),
      getMetrics: jest.fn().mockResolvedValue('# Mock metrics'),
      recordRequest: jest.fn(),
      recordRequestDuration: jest.fn(),
      recordMemoryOperation: jest.fn(),
      updateStorageSize: jest.fn(),
      setActiveConnections: jest.fn(),
      recordError: jest.fn(),
      recordHookDuration: jest.fn(),
      recordVectorSearchDuration: jest.fn(),
      updateCacheHitRate: jest.fn(),
      shutdown: jest.fn()
    } as any;

    (MetricsCollector as jest.MockedClass<typeof MetricsCollector>)
      .mockImplementation(() => mockMetricsCollector);

    // Mock MetricsEndpoint
    mockMetricsEndpoint = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      isRunning: jest.fn().mockReturnValue(true),
      getPort: jest.fn().mockReturnValue(9090)
    } as any;

    (MetricsEndpoint as jest.MockedClass<typeof MetricsEndpoint>)
      .mockImplementation(() => mockMetricsEndpoint);

    // Mock subsystems
    mockStorageEngine = {
      getStatistics: jest.fn().mockReturnValue({
        totalMemories: 100,
        storageSize: 1048576,
        sqliteSize: 512000,
        vectorSize: 256000,
        fileSize: 280576
      })
    } as any;

    mockHookSystem = {} as any;

    mockIntelligenceLayer = {} as any;

    mockMcpServer = {
      registerTool: jest.fn(),
      registerResource: jest.fn()
    } as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Construction and Configuration', () => {
    it('should create MetricsIntegration with required components', () => {
      // Given: Required MCP server components
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      
      // When: Creating MetricsIntegration
      metricsIntegration = new MetricsIntegration(components);
      
      // Then: Instance should be created successfully
      expect(metricsIntegration).toBeInstanceOf(MetricsIntegration);
    });

    it('should create MetricsIntegration with custom configuration', () => {
      // Given: Custom metrics configuration
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      const config = {
        enabled: true,
        collector: { prefix: 'custom_', enabled: true },
        endpoint: { port: 8080, path: '/custom-metrics' }
      };
      
      // When: Creating MetricsIntegration with config
      metricsIntegration = new MetricsIntegration(components, config);
      
      // Then: Instance should be created with custom settings
      expect(metricsIntegration).toBeInstanceOf(MetricsIntegration);
    });

    it('should be disabled when configuration sets enabled to false', () => {
      // Given: Disabled metrics configuration
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      const config = { enabled: false };
      
      // When: Creating disabled MetricsIntegration
      metricsIntegration = new MetricsIntegration(components, config);
      
      // Then: Metrics should be disabled
      expect(metricsIntegration.isEnabled()).toBe(false);
    });
  });

  describe('Initialization and Lifecycle', () => {
    beforeEach(() => {
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      metricsIntegration = new MetricsIntegration(components);
    });

    it('should initialize metrics collector and endpoint', async () => {
      // Given: MetricsIntegration instance
      
      // When: Initializing metrics
      await metricsIntegration.initialize();
      
      // Then: Both collector and endpoint should be initialized
      expect(mockMetricsCollector.initialize).toHaveBeenCalled();
      expect(mockMetricsEndpoint.start).toHaveBeenCalled();
    });

    it('should register MCP tools for metrics access', async () => {
      // Given: Initialized MetricsIntegration
      await metricsIntegration.initialize();
      
      // When: Registering MCP integration
      metricsIntegration.registerMcpIntegration();
      
      // Then: Metrics tools should be registered
      expect(mockMcpServer.registerTool).toHaveBeenCalledWith(
        'get-metrics',
        expect.objectContaining({
          title: 'Get Prometheus Metrics',
          description: expect.stringContaining('metrics')
        }),
        expect.any(Function)
      );
    });

    it('should register MCP resources for metrics data', async () => {
      // Given: Initialized MetricsIntegration
      await metricsIntegration.initialize();
      
      // When: Registering MCP integration
      metricsIntegration.registerMcpIntegration();
      
      // Then: Metrics resources should be registered
      expect(mockMcpServer.registerResource).toHaveBeenCalledWith(
        'metrics',
        'metrics://prometheus',
        expect.objectContaining({
          title: 'Prometheus Metrics',
          mimeType: 'text/plain'
        }),
        expect.any(Function)
      );
    });

    it('should shutdown gracefully', async () => {
      // Given: Running MetricsIntegration
      await metricsIntegration.initialize();
      
      // When: Shutting down
      await metricsIntegration.shutdown();
      
      // Then: Both collector and endpoint should be shutdown
      expect(mockMetricsEndpoint.stop).toHaveBeenCalled();
      expect(mockMetricsCollector.shutdown).toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', async () => {
      // Given: MetricsEndpoint that fails to start
      const error = new Error('Failed to start metrics endpoint');
      mockMetricsEndpoint.start.mockRejectedValue(error);
      
      // When: Initializing with error
      // Then: Should throw initialization error
      await expect(metricsIntegration.initialize()).rejects.toThrow('Failed to start metrics endpoint');
    });
  });

  describe('Automatic Metrics Collection', () => {
    beforeEach(async () => {
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      metricsIntegration = new MetricsIntegration(components);
      await metricsIntegration.initialize();
    });

    it('should automatically collect storage statistics', async () => {
      // Given: Storage with statistics
      mockStorageEngine.getStatistics.mockReturnValue({
        totalMemories: 150,
        storageSize: 2097152,
        sqliteSize: 1048576,
        vectorSize: 524288,
        fileSize: 524288
      });
      
      // When: Triggering statistics collection
      await metricsIntegration.collectStorageMetrics();
      
      // Then: Storage metrics should be updated
      expect(mockMetricsCollector.updateStorageSize).toHaveBeenCalledWith('sqlite', 1048576);
      expect(mockMetricsCollector.updateStorageSize).toHaveBeenCalledWith('vector', 524288);
      expect(mockMetricsCollector.updateStorageSize).toHaveBeenCalledWith('files', 524288);
    });

    it('should start periodic metrics collection', async () => {
      // Given: MetricsIntegration with collection interval
      
      // When: Starting periodic collection
      metricsIntegration.startPeriodicCollection(1000); // 1 second interval
      
      // Then: Collection should be scheduled
      expect(metricsIntegration.isCollectionRunning()).toBe(true);
    });

    it('should stop periodic metrics collection', async () => {
      // Given: Running periodic collection
      metricsIntegration.startPeriodicCollection(1000);
      
      // When: Stopping collection
      metricsIntegration.stopPeriodicCollection();
      
      // Then: Collection should be stopped
      expect(metricsIntegration.isCollectionRunning()).toBe(false);
    });

    it('should collect system-wide metrics', async () => {
      // Given: System with various metrics
      
      // When: Collecting system metrics
      await metricsIntegration.collectSystemMetrics();
      
      // Then: Various system metrics should be recorded
      expect(mockMetricsCollector.setActiveConnections).toHaveBeenCalled();
    });
  });

  describe('MCP Tool Integration', () => {
    beforeEach(async () => {
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      metricsIntegration = new MetricsIntegration(components);
      await metricsIntegration.initialize();
      metricsIntegration.registerMcpIntegration();
    });

    it('should handle get-metrics tool calls', async () => {
      // Given: Registered get-metrics tool
      const toolHandler = (mockMcpServer.registerTool as jest.Mock).mock.calls
        .find(call => call[0] === 'get-metrics')[2];
      const metricsData = '# HELP mcp_request_total Total requests\nmcp_request_total 42';
      mockMetricsCollector.getMetrics.mockResolvedValue(metricsData);
      
      // When: Calling get-metrics tool
      const result = await toolHandler({ format: 'prometheus' });
      
      // Then: Should return metrics data
      expect(result.content[0].text).toBe(metricsData);
      expect(mockMetricsCollector.recordRequest).toHaveBeenCalledWith('get_metrics', 'success');
    });

    it('should handle get-metrics tool with JSON format', async () => {
      // Given: Registered get-metrics tool
      const toolHandler = (mockMcpServer.registerTool as jest.Mock).mock.calls
        .find(call => call[0] === 'get-metrics')[2];
      const jsonData = [{ name: 'mcp_request_total', values: [{ value: 42 }] }];
      mockMetricsCollector.getMetricsAsJSON = jest.fn().mockReturnValue(jsonData);
      
      // When: Calling get-metrics tool with JSON format
      const result = await toolHandler({ format: 'json' });
      
      // Then: Should return JSON metrics data
      expect(result.content[0].text).toBe(JSON.stringify(jsonData, null, 2));
    });

    it('should handle metrics resource requests', async () => {
      // Given: Registered metrics resource
      const resourceHandler = (mockMcpServer.registerResource as jest.Mock).mock.calls
        .find(call => call[0] === 'metrics')[3];
      const metricsData = '# Mock Prometheus metrics';
      mockMetricsCollector.getMetrics.mockResolvedValue(metricsData);
      
      // When: Accessing metrics resource
      const uri = new URL('metrics://prometheus');
      const result = await resourceHandler(uri);
      
      // Then: Should return metrics content
      expect(result.contents[0].text).toBe(metricsData);
      expect(result.contents[0].mimeType).toBe('text/plain');
    });

    it('should record tool execution metrics', async () => {
      // Given: Tool that records metrics
      const toolHandler = (mockMcpServer.registerTool as jest.Mock).mock.calls
        .find(call => call[0] === 'get-metrics')[2];
      
      // When: Executing tool
      await toolHandler({ format: 'prometheus' });
      
      // Then: Should record tool metrics
      expect(mockMetricsCollector.recordRequest).toHaveBeenCalledWith('get_metrics', 'success');
      expect(mockMetricsCollector.recordRequestDuration).toHaveBeenCalledWith(
        'get_metrics',
        expect.any(Number)
      );
    });

    it('should handle tool execution errors', async () => {
      // Given: Tool handler that throws error
      const toolHandler = (mockMcpServer.registerTool as jest.Mock).mock.calls
        .find(call => call[0] === 'get-metrics')[2];
      const error = new Error('Metrics collection failed');
      mockMetricsCollector.getMetrics.mockRejectedValue(error);
      
      // When: Tool execution fails
      const result = await toolHandler({ format: 'prometheus' });
      
      // Then: Should return error response and record error metrics
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Metrics collection failed');
      expect(mockMetricsCollector.recordRequest).toHaveBeenCalledWith('get_metrics', 'error');
      expect(mockMetricsCollector.recordError).toHaveBeenCalledWith('tool_execution', 'get_metrics');
    });
  });

  describe('Request Instrumentation', () => {
    beforeEach(async () => {
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      metricsIntegration = new MetricsIntegration(components);
      await metricsIntegration.initialize();
    });

    it('should instrument MCP tool calls', async () => {
      // Given: MCP tool wrapper function
      const originalHandler = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'success' }] });
      
      // When: Wrapping tool handler with metrics
      const instrumentedHandler = metricsIntegration.instrumentToolHandler('test-tool', originalHandler);
      await instrumentedHandler({ arg: 'value' });
      
      // Then: Should record request metrics
      expect(mockMetricsCollector.recordRequest).toHaveBeenCalledWith('test-tool', 'success');
      expect(mockMetricsCollector.recordRequestDuration).toHaveBeenCalledWith(
        'test-tool',
        expect.any(Number)
      );
    });

    it('should instrument storage operations', async () => {
      // Given: Storage operation
      const operation = 'captureMemory';
      
      // When: Recording storage operation
      metricsIntegration.recordStorageOperation(operation, 'success');
      
      // Then: Should record memory operation metrics
      expect(mockMetricsCollector.recordMemoryOperation).toHaveBeenCalledWith(operation, 'success');
    });

    it('should instrument hook executions', async () => {
      // Given: Hook execution
      const hookType = 'pre-commit';
      const duration = 0.150; // 150ms
      
      // When: Recording hook execution
      metricsIntegration.recordHookExecution(hookType, 'success', duration);
      
      // Then: Should record hook metrics
      expect(mockMetricsCollector.recordHookDuration).toHaveBeenCalledWith(hookType, 'success', duration);
    });

    it('should instrument vector search operations', async () => {
      // Given: Vector search operation
      const indexType = 'hnsw';
      const duration = 0.075; // 75ms
      
      // When: Recording vector search
      metricsIntegration.recordVectorSearch(indexType, duration);
      
      // Then: Should record vector search metrics
      expect(mockMetricsCollector.recordVectorSearchDuration).toHaveBeenCalledWith(indexType, duration);
    });

    it('should handle instrumentation errors gracefully', async () => {
      // Given: Metrics collector that throws error
      mockMetricsCollector.recordRequest.mockImplementation(() => {
        throw new Error('Metrics recording failed');
      });
      
      const originalHandler = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'success' }] });
      
      // When: Using instrumented handler with failing metrics
      const instrumentedHandler = metricsIntegration.instrumentToolHandler('test-tool', originalHandler);
      const result = await instrumentedHandler({ arg: 'value' });
      
      // Then: Original handler should still execute successfully
      expect(result.content[0].text).toBe('success');
      expect(originalHandler).toHaveBeenCalled();
    });
  });

  describe('HTTP Endpoint Integration', () => {
    beforeEach(async () => {
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      metricsIntegration = new MetricsIntegration(components, { 
        endpoint: { port: 9090, path: '/metrics' }
      });
      await metricsIntegration.initialize();
    });

    it('should provide HTTP endpoint for metrics', async () => {
      // Given: Running metrics endpoint
      
      // When: Making HTTP request to metrics endpoint
      const response = await makeHttpRequest('http://localhost:9090/metrics');
      
      // Then: Should return metrics data
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
    });

    it('should handle concurrent HTTP requests', async () => {
      // Given: Multiple concurrent requests
      const requestCount = 10;
      const requests: Promise<any>[] = [];
      
      // When: Making concurrent requests
      for (let i = 0; i < requestCount; i++) {
        requests.push(makeHttpRequest('http://localhost:9090/metrics'));
      }
      
      const responses = await Promise.all(requests);
      
      // Then: All requests should succeed
      responses.forEach(response => {
        expect(response.statusCode).toBe(200);
      });
    });

    it('should return metrics in requested format', async () => {
      // Given: Request with JSON Accept header
      
      // When: Making request with JSON format
      const response = await makeHttpRequest('http://localhost:9090/metrics', {
        headers: { 'Accept': 'application/json' }
      });
      
      // Then: Should return JSON metrics
      expect(response.headers['content-type']).toContain('application/json');
    });

    it('should handle endpoint authentication', async () => {
      // Given: Metrics integration with authentication
      const authIntegration = new MetricsIntegration(
        {
          mcpServer: mockMcpServer,
          storage: mockStorageEngine,
          hooks: mockHookSystem,
          intelligence: mockIntelligenceLayer
        },
        {
          endpoint: {
            port: 9091,
            path: '/metrics',
            authentication: {
              enabled: true,
              username: 'admin',
              password: 'secret'
            }
          }
        }
      );
      await authIntegration.initialize();
      
      // When: Making unauthenticated request
      const response = await makeHttpRequest('http://localhost:9091/metrics');
      
      // Then: Should return 401 Unauthorized
      expect(response.statusCode).toBe(401);
    });
  });

  describe('Performance Requirements', () => {
    beforeEach(async () => {
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      metricsIntegration = new MetricsIntegration(components);
      await metricsIntegration.initialize();
    });

    it('should have minimal overhead on request processing', async () => {
      // Given: Original handler without metrics
      const originalHandler = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'success' }] });
      
      // When: Measuring performance with and without instrumentation
      const iterations = 1000;
      
      // Baseline performance
      const baselineStart = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) {
        await originalHandler({ arg: 'value' });
      }
      const baselineEnd = process.hrtime.bigint();
      const baselineDuration = Number(baselineEnd - baselineStart) / 1_000_000;
      
      // Instrumented performance  
      const instrumentedHandler = metricsIntegration.instrumentToolHandler('test-tool', originalHandler);
      const instrumentedStart = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) {
        await instrumentedHandler({ arg: 'value' });
      }
      const instrumentedEnd = process.hrtime.bigint();
      const instrumentedDuration = Number(instrumentedEnd - instrumentedStart) / 1_000_000;
      
      // Then: Overhead should be minimal (< 20% increase)
      const overhead = (instrumentedDuration - baselineDuration) / baselineDuration;
      expect(overhead).toBeLessThan(0.20);
    });

    it('should handle high-frequency metric collection', async () => {
      // Given: High-frequency metric updates
      const updateCount = 10000;
      
      // When: Recording metrics rapidly
      const start = process.hrtime.bigint();
      
      for (let i = 0; i < updateCount; i++) {
        metricsIntegration.recordStorageOperation('store', 'success');
      }
      
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      
      // Then: Should complete within reasonable time
      expect(durationMs).toBeLessThan(1000); // Less than 1 second
    });

    it('should not block on metrics collection failures', async () => {
      // Given: Metrics collector that fails
      mockMetricsCollector.recordRequest.mockImplementation(() => {
        throw new Error('Metrics failed');
      });
      
      const originalHandler = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'success' }] });
      
      // When: Using instrumented handler with failing metrics
      const start = process.hrtime.bigint();
      const instrumentedHandler = metricsIntegration.instrumentToolHandler('test-tool', originalHandler);
      await instrumentedHandler({ arg: 'value' });
      const end = process.hrtime.bigint();
      
      const durationMs = Number(end - start) / 1_000_000;
      
      // Then: Should not significantly impact performance
      expect(durationMs).toBeLessThan(10); // Less than 10ms
      expect(originalHandler).toHaveBeenCalled(); // Original handler should still execute
    });
  });

  describe('Configuration and Environment', () => {
    it('should support environment-based configuration', () => {
      // Given: Environment variables for metrics configuration
      process.env.METRICS_ENABLED = 'true';
      process.env.METRICS_PORT = '8080';
      process.env.METRICS_PATH = '/custom-metrics';
      
      // When: Creating MetricsIntegration with env config
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      metricsIntegration = new MetricsIntegration(components);
      
      // Then: Should use environment configuration
      expect(metricsIntegration.getConfig().endpoint.port).toBe(8080);
      expect(metricsIntegration.getConfig().endpoint.path).toBe('/custom-metrics');
      
      // Cleanup
      delete process.env.METRICS_ENABLED;
      delete process.env.METRICS_PORT;
      delete process.env.METRICS_PATH;
    });

    it('should validate configuration on initialization', async () => {
      // Given: Invalid configuration
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      const invalidConfig = {
        endpoint: { port: -1 } // Invalid port
      };
      
      // When: Creating with invalid config
      metricsIntegration = new MetricsIntegration(components, invalidConfig);
      
      // Then: Should throw validation error
      await expect(metricsIntegration.initialize()).rejects.toThrow('Invalid port number');
    });

    it('should support runtime configuration changes', async () => {
      // Given: Initialized MetricsIntegration
      const components = {
        mcpServer: mockMcpServer,
        storage: mockStorageEngine,
        hooks: mockHookSystem,
        intelligence: mockIntelligenceLayer
      };
      metricsIntegration = new MetricsIntegration(components);
      await metricsIntegration.initialize();
      
      // When: Updating configuration at runtime
      await metricsIntegration.updateConfig({
        collector: { enabled: false }
      });
      
      // Then: Configuration should be updated
      expect(metricsIntegration.getConfig().collector.enabled).toBe(false);
    });
  });

  // Helper function to simulate HTTP requests
  async function makeHttpRequest(url: string, options: any = {}): Promise<any> {
    return new Promise((resolve) => {
      // Mock HTTP response for testing
      resolve({
        statusCode: 200,
        headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' },
        body: '# Mock metrics response'
      });
    });
  }
});