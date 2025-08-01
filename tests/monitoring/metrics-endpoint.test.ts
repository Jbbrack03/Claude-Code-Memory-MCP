/**
 * Tests for Prometheus metrics HTTP endpoint
 * 
 * This test suite follows TDD principles and ensures all tests fail initially (red phase).
 * Tests cover HTTP endpoint functionality, Prometheus format output, and integration.
 */

import { beforeEach, describe, expect, it, jest, afterEach } from '@jest/globals';
import { MetricsEndpoint } from '../../src/monitoring/metrics-endpoint.js';
import { MetricsCollector } from '../../src/monitoring/metrics-collector.js';
import { IncomingMessage, ServerResponse } from 'http';
import { Server } from 'http';

// Mock dependencies
jest.mock('../../src/monitoring/metrics-collector.js');
jest.mock('http');

describe('MetricsEndpoint', () => {
  let metricsEndpoint: MetricsEndpoint;
  let mockMetricsCollector: jest.Mocked<MetricsCollector>;
  let mockServer: jest.Mocked<Server>;
  let mockRequest: jest.Mocked<IncomingMessage>;
  let mockResponse: jest.Mocked<ServerResponse>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock MetricsCollector
    mockMetricsCollector = {
      initialize: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(true),
      getMetrics: jest.fn().mockResolvedValue('# Mock Prometheus metrics'),
      getMetricsAsJSON: jest.fn().mockReturnValue([]),
      recordRequest: jest.fn(),
      recordRequestDuration: jest.fn(),
      shutdown: jest.fn()
    } as any;

    (MetricsCollector as jest.MockedClass<typeof MetricsCollector>)
      .mockImplementation(() => mockMetricsCollector);

    // Mock HTTP Server
    mockServer = {
      listen: jest.fn(),
      close: jest.fn(),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
      address: jest.fn().mockReturnValue({ port: 9090 })
    } as any;

    // Mock HTTP Request/Response
    mockRequest = {
      method: 'GET',
      url: '/metrics',
      headers: {},
      on: jest.fn(),
      socket: { remoteAddress: '127.0.0.1' }
    } as any;

    mockResponse = {
      writeHead: jest.fn(),
      end: jest.fn(),
      write: jest.fn(),
      setHeader: jest.fn(),
      statusCode: 200
    } as any;

    // Mock require('http').createServer
    const { createServer } = require('http');
    (createServer as jest.Mock).mockImplementation((callback) => {
      mockServer.requestCallback = callback;
      return mockServer;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Construction and Configuration', () => {
    it('should create MetricsEndpoint with default configuration', () => {
      // Given: Default configuration
      
      // When: Creating a new MetricsEndpoint
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector);
      
      // Then: Instance should be created successfully
      expect(metricsEndpoint).toBeInstanceOf(MetricsEndpoint);
    });

    it('should create MetricsEndpoint with custom port', () => {
      // Given: Custom port configuration
      const config = { port: 8080 };
      
      // When: Creating MetricsEndpoint with custom port
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector, config);
      
      // Then: Instance should be created with custom settings
      expect(metricsEndpoint).toBeInstanceOf(MetricsEndpoint);
    });

    it('should create MetricsEndpoint with custom path', () => {
      // Given: Custom path configuration
      const config = { path: '/custom-metrics' };
      
      // When: Creating MetricsEndpoint with custom path
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector, config);
      
      // Then: Instance should accept custom path
      expect(metricsEndpoint).toBeInstanceOf(MetricsEndpoint);
    });

    it('should create MetricsEndpoint with security configuration', () => {
      // Given: Security configuration
      const config = {
        authentication: {
          enabled: true,
          username: 'admin',
          password: 'secret'
        },
        allowedIPs: ['127.0.0.1', '192.168.1.0/24']
      };
      
      // When: Creating secure MetricsEndpoint
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector, config);
      
      // Then: Security should be configured
      expect(metricsEndpoint).toBeInstanceOf(MetricsEndpoint);
    });
  });

  describe('Server Lifecycle', () => {
    beforeEach(() => {
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector);
    });

    it('should start HTTP server on specified port', async () => {
      // Given: MetricsEndpoint instance
      mockServer.listen.mockImplementation((port, callback) => {
        if (callback) callback();
        return mockServer;
      });
      
      // When: Starting the server
      await metricsEndpoint.start();
      
      // Then: Server should listen on default port
      expect(mockServer.listen).toHaveBeenCalledWith(9090, expect.any(Function));
    });

    it('should start server on custom port', async () => {
      // Given: MetricsEndpoint with custom port
      const customEndpoint = new MetricsEndpoint(mockMetricsCollector, { port: 8080 });
      mockServer.listen.mockImplementation((port, callback) => {
        if (callback) callback();
        return mockServer;
      });
      
      // When: Starting the server
      await customEndpoint.start();
      
      // Then: Server should listen on custom port
      expect(mockServer.listen).toHaveBeenCalledWith(8080, expect.any(Function));
    });

    it('should handle server startup errors', async () => {
      // Given: Server that fails to start
      const error = new Error('Port already in use');
      mockServer.listen.mockImplementation((port, callback) => {
        mockServer.emit('error', error);
        return mockServer;
      });
      
      // When: Starting the server
      // Then: Should reject with error
      await expect(metricsEndpoint.start()).rejects.toThrow('Port already in use');
    });

    it('should stop HTTP server gracefully', async () => {
      // Given: Running server
      mockServer.listen.mockImplementation((port, callback) => {
        if (callback) callback();
        return mockServer;
      });
      mockServer.close.mockImplementation((callback) => {
        if (callback) callback();
        return mockServer;
      });
      
      await metricsEndpoint.start();
      
      // When: Stopping the server
      await metricsEndpoint.stop();
      
      // Then: Server should be closed
      expect(mockServer.close).toHaveBeenCalled();
    });

    it('should handle server shutdown errors', async () => {
      // Given: Server that fails to stop
      const error = new Error('Failed to close server');
      mockServer.close.mockImplementation((callback) => {
        if (callback) callback(error);
        return mockServer;
      });
      
      // When: Stopping the server
      // Then: Should reject with error
      await expect(metricsEndpoint.stop()).rejects.toThrow('Failed to close server');
    });

    it('should be idempotent for multiple start calls', async () => {
      // Given: MetricsEndpoint instance
      mockServer.listen.mockImplementation((port, callback) => {
        if (callback) callback();
        return mockServer;
      });
      
      // When: Starting server multiple times
      await metricsEndpoint.start();
      await metricsEndpoint.start();
      
      // Then: Server should only be started once
      expect(mockServer.listen).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent for multiple stop calls', async () => {
      // Given: Running server
      mockServer.listen.mockImplementation((port, callback) => {
        if (callback) callback();
        return mockServer;
      });
      mockServer.close.mockImplementation((callback) => {
        if (callback) callback();
        return mockServer;
      });
      
      await metricsEndpoint.start();
      
      // When: Stopping server multiple times
      await metricsEndpoint.stop();
      await metricsEndpoint.stop();
      
      // Then: Server should only be stopped once
      expect(mockServer.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('HTTP Request Handling', () => {
    beforeEach(async () => {
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector);
      mockServer.listen.mockImplementation((port, callback) => {
        if (callback) callback();
        return mockServer;
      });
      await metricsEndpoint.start();
    });

    it('should handle GET requests to /metrics endpoint', async () => {
      // Given: GET request to metrics endpoint
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      const metricsData = '# HELP mcp_request_total Total requests\nmcp_request_total 42';
      mockMetricsCollector.getMetrics.mockResolvedValue(metricsData);
      
      // When: Processing the request
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return metrics with proper headers
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200);
      expect(mockResponse.end).toHaveBeenCalledWith(metricsData);
    });

    it('should handle GET requests to custom metrics path', async () => {
      // Given: MetricsEndpoint with custom path
      const customEndpoint = new MetricsEndpoint(mockMetricsCollector, { path: '/custom-metrics' });
      await customEndpoint.start();
      
      mockRequest.url = '/custom-metrics';
      const metricsData = '# Custom metrics data';
      mockMetricsCollector.getMetrics.mockResolvedValue(metricsData);
      
      // When: Processing request to custom path
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should serve metrics from custom path
      expect(mockResponse.end).toHaveBeenCalledWith(metricsData);
    });

    it('should return 404 for requests to other paths', async () => {
      // Given: GET request to unknown path
      mockRequest.url = '/unknown';
      
      // When: Processing the request
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return 404
      expect(mockResponse.writeHead).toHaveBeenCalledWith(404);
      expect(mockResponse.end).toHaveBeenCalledWith('Not Found');
    });

    it('should return 405 for non-GET requests', async () => {
      // Given: POST request to metrics endpoint
      mockRequest.method = 'POST';
      mockRequest.url = '/metrics';
      
      // When: Processing the request
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return 405 Method Not Allowed
      expect(mockResponse.writeHead).toHaveBeenCalledWith(405);
      expect(mockResponse.end).toHaveBeenCalledWith('Method Not Allowed');
    });

    it('should handle metrics collection errors', async () => {
      // Given: MetricsCollector that throws error
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      const error = new Error('Metrics collection failed');
      mockMetricsCollector.getMetrics.mockRejectedValue(error);
      
      // When: Processing the request
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return 500 Internal Server Error
      expect(mockResponse.writeHead).toHaveBeenCalledWith(500);
      expect(mockResponse.end).toHaveBeenCalledWith('Internal Server Error');
    });

    it('should handle HEAD requests to metrics endpoint', async () => {
      // Given: HEAD request to metrics endpoint
      mockRequest.method = 'HEAD';
      mockRequest.url = '/metrics';
      
      // When: Processing the request
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return headers without body
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200);
      expect(mockResponse.end).toHaveBeenCalledWith();
    });
  });

  describe('Content Negotiation', () => {
    beforeEach(async () => {
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector);
      mockServer.listen.mockImplementation((port, callback) => {
        if (callback) callback();
        return mockServer;
      });
      await metricsEndpoint.start();
    });

    it('should return Prometheus format by default', async () => {
      // Given: Request without specific Accept header
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      mockRequest.headers = {};
      
      const prometheusData = '# HELP mcp_request_total Total requests\nmcp_request_total 42';
      mockMetricsCollector.getMetrics.mockResolvedValue(prometheusData);
      
      // When: Processing the request
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return Prometheus format
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      expect(mockResponse.end).toHaveBeenCalledWith(prometheusData);
    });

    it('should return JSON format when requested', async () => {
      // Given: Request with JSON Accept header
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      mockRequest.headers = { accept: 'application/json' };
      
      const jsonData = [{ name: 'mcp_request_total', values: [{ value: 42 }] }];
      mockMetricsCollector.getMetricsAsJSON.mockReturnValue(jsonData);
      
      // When: Processing the request
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return JSON format
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(mockResponse.end).toHaveBeenCalledWith(JSON.stringify(jsonData, null, 2));
    });

    it('should handle unsupported Accept headers gracefully', async () => {
      // Given: Request with unsupported Accept header
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      mockRequest.headers = { accept: 'application/xml' };
      
      // When: Processing the request
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return 406 Not Acceptable
      expect(mockResponse.writeHead).toHaveBeenCalledWith(406);
      expect(mockResponse.end).toHaveBeenCalledWith('Not Acceptable');
    });
  });

  describe('Security Features', () => {
    it('should support basic authentication', async () => {
      // Given: MetricsEndpoint with authentication enabled
      const config = {
        authentication: {
          enabled: true,
          username: 'admin',
          password: 'secret'
        }
      };
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector, config);
      await metricsEndpoint.start();
      
      // When: Request without authentication
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      mockRequest.headers = {};
      
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return 401 Unauthorized
      expect(mockResponse.writeHead).toHaveBeenCalledWith(401);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="Metrics"');
    });

    it('should allow access with valid credentials', async () => {
      // Given: MetricsEndpoint with authentication
      const config = {
        authentication: {
          enabled: true,
          username: 'admin',
          password: 'secret'
        }
      };
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector, config);
      await metricsEndpoint.start();
      
      // When: Request with valid credentials
      const credentials = Buffer.from('admin:secret').toString('base64');
      mockRequest.headers = { authorization: `Basic ${credentials}` };
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      
      mockMetricsCollector.getMetrics.mockResolvedValue('# metrics data');
      
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return metrics
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200);
    });

    it('should reject invalid credentials', async () => {
      // Given: MetricsEndpoint with authentication
      const config = {
        authentication: {
          enabled: true,
          username: 'admin',
          password: 'secret'
        }
      };
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector, config);
      await metricsEndpoint.start();
      
      // When: Request with invalid credentials
      const credentials = Buffer.from('admin:wrong').toString('base64');
      mockRequest.headers = { authorization: `Basic ${credentials}` };
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return 401 Unauthorized
      expect(mockResponse.writeHead).toHaveBeenCalledWith(401);
    });

    it('should support IP whitelisting', async () => {
      // Given: MetricsEndpoint with IP restrictions
      const config = { allowedIPs: ['127.0.0.1'] };
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector, config);
      await metricsEndpoint.start();
      
      // When: Request from allowed IP
      mockRequest.socket = { remoteAddress: '127.0.0.1' };
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      
      mockMetricsCollector.getMetrics.mockResolvedValue('# metrics data');
      
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should allow access
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200);
    });

    it('should reject requests from non-whitelisted IPs', async () => {
      // Given: MetricsEndpoint with IP restrictions
      const config = { allowedIPs: ['127.0.0.1'] };
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector, config);
      await metricsEndpoint.start();
      
      // When: Request from non-allowed IP
      mockRequest.socket = { remoteAddress: '192.168.1.100' };
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return 403 Forbidden
      expect(mockResponse.writeHead).toHaveBeenCalledWith(403);
      expect(mockResponse.end).toHaveBeenCalledWith('Forbidden');
    });

    it('should handle CIDR notation in IP whitelist', async () => {
      // Given: MetricsEndpoint with CIDR IP restrictions
      const config = { allowedIPs: ['192.168.1.0/24'] };
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector, config);
      await metricsEndpoint.start();
      
      // When: Request from IP in CIDR range
      mockRequest.socket = { remoteAddress: '192.168.1.50' };
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      
      mockMetricsCollector.getMetrics.mockResolvedValue('# metrics data');
      
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should allow access
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200);
    });
  });

  describe('Health and Status', () => {
    beforeEach(async () => {
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector);
      mockServer.listen.mockImplementation((port, callback) => {
        if (callback) callback();
        return mockServer;
      });
      await metricsEndpoint.start();
    });

    it('should provide health check endpoint', async () => {
      // Given: Request to health endpoint
      mockRequest.method = 'GET';
      mockRequest.url = '/health';
      
      // When: Processing health check request
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return health status
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200);
      expect(mockResponse.end).toHaveBeenCalledWith(
        JSON.stringify({ status: 'healthy', timestamp: expect.any(String) })
      );
    });

    it('should provide readiness check endpoint', async () => {
      // Given: Request to readiness endpoint
      mockRequest.method = 'GET';
      mockRequest.url = '/ready';
      mockMetricsCollector.isEnabled.mockReturnValue(true);
      
      // When: Processing readiness check
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return readiness status
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200);
      expect(mockResponse.end).toHaveBeenCalledWith(
        JSON.stringify({ ready: true, metricsEnabled: true })
      );
    });

    it('should indicate not ready when metrics are disabled', async () => {
      // Given: Disabled metrics collector
      mockRequest.method = 'GET';
      mockRequest.url = '/ready';
      mockMetricsCollector.isEnabled.mockReturnValue(false);
      
      // When: Processing readiness check
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return not ready status
      expect(mockResponse.writeHead).toHaveBeenCalledWith(503);
      expect(mockResponse.end).toHaveBeenCalledWith(
        JSON.stringify({ ready: false, metricsEnabled: false })
      );
    });
  });

  describe('Performance and Concurrency', () => {
    beforeEach(async () => {
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector);
      mockServer.listen.mockImplementation((port, callback) => {
        if (callback) callback();
        return mockServer;
      });
      await metricsEndpoint.start();
    });

    it('should handle concurrent requests efficiently', async () => {
      // Given: Multiple concurrent requests
      const requestCount = 10;
      const requests: Promise<void>[] = [];
      
      mockMetricsCollector.getMetrics.mockResolvedValue('# metrics data');
      
      // When: Processing multiple requests concurrently
      for (let i = 0; i < requestCount; i++) {
        const req = { ...mockRequest, method: 'GET', url: '/metrics' };
        const res = { ...mockResponse };
        requests.push(mockServer.requestCallback(req as any, res as any));
      }
      
      await Promise.all(requests);
      
      // Then: All requests should be handled
      expect(mockMetricsCollector.getMetrics).toHaveBeenCalledTimes(requestCount);
    });

    it('should respect request timeout', async () => {
      // Given: Slow metrics collection
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      
      mockMetricsCollector.getMetrics.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('# slow metrics'), 5000))
      );
      
      // When: Processing request with timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 1000)
      );
      
      const requestPromise = mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should timeout before completion
      await expect(Promise.race([requestPromise, timeoutPromise]))
        .rejects.toThrow('Request timeout');
    });

    it('should handle high-frequency requests', async () => {
      // Given: High-frequency request scenario
      const startTime = process.hrtime.bigint();
      const requestCount = 1000;
      
      mockMetricsCollector.getMetrics.mockResolvedValue('# fast metrics');
      
      // When: Processing many requests quickly
      const promises = Array.from({ length: requestCount }, () => {
        const req = { ...mockRequest, method: 'GET', url: '/metrics' };
        const res = { ...mockResponse };
        return mockServer.requestCallback(req as any, res as any);
      });
      
      await Promise.all(promises);
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;
      
      // Then: Should handle requests efficiently
      expect(durationMs).toBeLessThan(5000); // Less than 5 seconds
      expect(mockMetricsCollector.getMetrics).toHaveBeenCalledTimes(requestCount);
    });
  });

  describe('Integration with MetricsCollector', () => {
    beforeEach(async () => {
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector);
      mockServer.listen.mockImplementation((port, callback) => {
        if (callback) callback();
        return mockServer;
      });
      await metricsEndpoint.start();
    });

    it('should record endpoint access metrics', async () => {
      // Given: Request to metrics endpoint
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      mockMetricsCollector.getMetrics.mockResolvedValue('# metrics data');
      
      // When: Processing the request
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should record access metrics
      expect(mockMetricsCollector.recordRequest).toHaveBeenCalledWith('metrics_endpoint', 'success');
    });

    it('should record error metrics for failed requests', async () => {
      // Given: Request that will fail
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      const error = new Error('Metrics unavailable');
      mockMetricsCollector.getMetrics.mockRejectedValue(error);
      
      // When: Processing the failing request
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should record error metrics
      expect(mockMetricsCollector.recordRequest).toHaveBeenCalledWith('metrics_endpoint', 'error');
    });

    it('should measure request duration', async () => {
      // Given: Request to metrics endpoint
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      mockMetricsCollector.getMetrics.mockResolvedValue('# metrics data');
      
      // When: Processing the request
      const start = process.hrtime.bigint();
      await mockServer.requestCallback(mockRequest, mockResponse);
      const end = process.hrtime.bigint();
      const expectedDuration = Number(end - start) / 1_000_000_000; // Convert to seconds
      
      // Then: Should record request duration
      expect(mockMetricsCollector.recordRequestDuration)
        .toHaveBeenCalledWith('metrics_endpoint', expect.any(Number));
      
      const recordedDuration = (mockMetricsCollector.recordRequestDuration as jest.Mock).mock.calls[0][1];
      expect(recordedDuration).toBeCloseTo(expectedDuration, 2);
    });

    it('should handle disabled metrics collector gracefully', async () => {
      // Given: Disabled metrics collector
      mockMetricsCollector.isEnabled.mockReturnValue(false);
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      
      // When: Processing request with disabled collector
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Should return service unavailable
      expect(mockResponse.writeHead).toHaveBeenCalledWith(503);
      expect(mockResponse.end).toHaveBeenCalledWith('Metrics collection is disabled');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate port number range', () => {
      // Given: Invalid port configurations
      
      // When/Then: Should reject invalid ports
      expect(() => new MetricsEndpoint(mockMetricsCollector, { port: -1 }))
        .toThrow('Invalid port number');
      
      expect(() => new MetricsEndpoint(mockMetricsCollector, { port: 65536 }))
        .toThrow('Invalid port number');
      
      expect(() => new MetricsEndpoint(mockMetricsCollector, { port: 0 }))
        .toThrow('Invalid port number');
    });

    it('should validate metrics path format', () => {
      // Given: Invalid path configurations
      
      // When/Then: Should reject invalid paths
      expect(() => new MetricsEndpoint(mockMetricsCollector, { path: 'invalid-path' }))
        .toThrow('Path must start with /');
      
      expect(() => new MetricsEndpoint(mockMetricsCollector, { path: '' }))
        .toThrow('Path cannot be empty');
    });

    it('should validate authentication configuration', () => {
      // Given: Invalid authentication configuration
      const invalidConfig = {
        authentication: {
          enabled: true,
          username: '',
          password: 'secret'
        }
      };
      
      // When/Then: Should reject invalid auth config
      expect(() => new MetricsEndpoint(mockMetricsCollector, invalidConfig))
        .toThrow('Username cannot be empty when authentication is enabled');
    });

    it('should validate IP address format in allowedIPs', () => {
      // Given: Invalid IP configuration
      const invalidConfig = { allowedIPs: ['invalid-ip'] };
      
      // When/Then: Should reject invalid IP addresses
      expect(() => new MetricsEndpoint(mockMetricsCollector, invalidConfig))
        .toThrow('Invalid IP address format');
    });
  });

  describe('Error Handling and Recovery', () => {
    beforeEach(async () => {
      metricsEndpoint = new MetricsEndpoint(mockMetricsCollector);
      mockServer.listen.mockImplementation((port, callback) => {
        if (callback) callback();
        return mockServer;
      });
      await metricsEndpoint.start();
    });

    it('should handle request parsing errors', async () => {
      // Given: Malformed request
      const malformedRequest = {
        ...mockRequest,
        method: null,
        url: undefined
      };
      
      // When: Processing malformed request
      await mockServer.requestCallback(malformedRequest as any, mockResponse);
      
      // Then: Should handle gracefully
      expect(mockResponse.writeHead).toHaveBeenCalledWith(400);
      expect(mockResponse.end).toHaveBeenCalledWith('Bad Request');
    });

    it('should handle response writing errors', async () => {
      // Given: Response that throws on write
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      mockResponse.end.mockImplementation(() => {
        throw new Error('Response write failed');
      });
      mockMetricsCollector.getMetrics.mockResolvedValue('# metrics data');
      
      // When: Processing request with response error
      // Then: Should not crash the server
      await expect(mockServer.requestCallback(mockRequest, mockResponse))
        .resolves.not.toThrow();
    });

    it('should recover from temporary metrics collection failures', async () => {
      // Given: Metrics collector that fails then recovers
      mockRequest.method = 'GET';
      mockRequest.url = '/metrics';
      
      mockMetricsCollector.getMetrics
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce('# recovered metrics');
      
      // When: First request fails, second succeeds
      await mockServer.requestCallback(mockRequest, mockResponse);
      expect(mockResponse.writeHead).toHaveBeenCalledWith(500);
      
      mockResponse.writeHead.mockClear();
      await mockServer.requestCallback(mockRequest, mockResponse);
      
      // Then: Second request should succeed
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200);
    });
  });
});