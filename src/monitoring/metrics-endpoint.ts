/**
 * HTTP endpoint for serving Prometheus metrics
 * 
 * This module provides a standalone HTTP server for exposing metrics in Prometheus format.
 * It supports authentication, IP whitelisting, and content negotiation.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { parse as parseUrl } from 'url';
import { MetricsCollector } from './metrics-collector.js';

export interface MetricsEndpointConfig {
  port?: number;
  path?: string;
  authentication?: {
    enabled: boolean;
    username: string;
    password: string;
  };
  allowedIPs?: string[];
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
}

export interface ReadinessStatus {
  ready: boolean;
  metricsEnabled: boolean;
}

export class MetricsEndpoint {
  private server?: Server;
  private config: Required<MetricsEndpointConfig>;
  private running = false;

  constructor(
    private metricsCollector: MetricsCollector,
    config: MetricsEndpointConfig = {}
  ) {
    // Validate configuration
    this.validateConfig(config);

    this.config = {
      port: config.port ?? 9090,
      path: config.path ?? '/metrics',
      authentication: config.authentication ?? {
        enabled: false,
        username: '',
        password: ''
      },
      allowedIPs: config.allowedIPs ?? []
    };
  }

  private validateConfig(config: MetricsEndpointConfig): void {
    if (config.port !== undefined && (config.port < 1 || config.port > 65535)) {
      throw new Error('Invalid port number');
    }

    if (config.path !== undefined) {
      if (config.path.length === 0) {
        throw new Error('Path cannot be empty');
      }
      if (!config.path.startsWith('/')) {
        throw new Error('Path must start with /');
      }
    }

    if (config.authentication?.enabled && !config.authentication.username) {
      throw new Error('Username cannot be empty when authentication is enabled');
    }

    if (config.allowedIPs) {
      for (const ip of config.allowedIPs) {
        if (!this.isValidIPAddress(ip)) {
          throw new Error('Invalid IP address format');
        }
      }
    }
  }

  private isValidIPAddress(ip: string): boolean {
    // Simple validation for IP addresses and CIDR notation
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    return ipv4Pattern.test(ip);
  }

  async start(): Promise<void> {
    if (this.running) {
      return; // Idempotent
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(this.config.port, () => {
        this.running = true;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return; // Idempotent
    }

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.running = false;
          resolve();
        }
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startTime = process.hrtime.bigint();

    try {
      // Basic request validation
      if (!req.method || !req.url) {
        this.sendResponse(res, 400, 'Bad Request');
        return;
      }

      // Parse URL
      const parsedUrl = parseUrl(req.url, true);
      const pathname = parsedUrl.pathname || '';

      // IP address validation
      if (!this.isIPAllowed(req)) {
        this.sendResponse(res, 403, 'Forbidden');
        return;
      }

      // Authentication check
      if (!this.isAuthenticated(req)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Metrics"');
        this.sendResponse(res, 401, 'Unauthorized');
        return;
      }

      // Route handling
      if (pathname === this.config.path) {
        await this.handleMetricsRequest(req, res);
      } else if (pathname === '/health') {
        await this.handleHealthRequest(req, res);
      } else if (pathname === '/ready') {
        await this.handleReadinessRequest(req, res);
      } else {
        this.sendResponse(res, 404, 'Not Found');
      }

      // Record successful request metrics
      this.metricsCollector.recordRequest('metrics_endpoint', 'success');
    } catch (error) {
      // Record error metrics
      this.metricsCollector.recordRequest('metrics_endpoint', 'error');
      this.sendResponse(res, 500, 'Internal Server Error');
    } finally {
      // Record request duration
      const endTime = process.hrtime.bigint();
      const durationSeconds = Number(endTime - startTime) / 1_000_000_000;
      this.metricsCollector.recordRequestDuration('metrics_endpoint', durationSeconds);
    }
  }

  private async handleMetricsRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      this.sendResponse(res, 405, 'Method Not Allowed');
      return;
    }

    // Check if metrics collection is enabled
    if (!this.metricsCollector.isEnabled()) {
      this.sendResponse(res, 503, 'Metrics collection is disabled');
      return;
    }

    // Content negotiation
    const acceptHeader = req.headers.accept || '';
    
    if (acceptHeader.includes('application/json')) {
      // Return JSON format
      const metrics = this.metricsCollector.getMetricsAsJSON();
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify(metrics, null, 2));
    } else if (acceptHeader.includes('application/xml')) {
      // Unsupported format
      this.sendResponse(res, 406, 'Not Acceptable');
    } else {
      // Default to Prometheus format
      const metrics = await this.metricsCollector.getMetrics();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.writeHead(200);
      res.end(metrics);
    }
  }

  private async handleHealthRequest(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const health: HealthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString()
    };

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(health));
  }

  private async handleReadinessRequest(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const metricsEnabled = this.metricsCollector.isEnabled();
    const readiness: ReadinessStatus = {
      ready: metricsEnabled,
      metricsEnabled
    };

    const statusCode = readiness.ready ? 200 : 503;
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(statusCode);
    res.end(JSON.stringify(readiness));
  }

  private isIPAllowed(req: IncomingMessage): boolean {
    if (this.config.allowedIPs.length === 0) {
      return true; // No restrictions
    }

    const clientIP = req.socket.remoteAddress;
    if (!clientIP) {
      return false;
    }

    return this.config.allowedIPs.some(allowedIP => {
      if (allowedIP.includes('/')) {
        // CIDR notation - simplified check
        const [network, prefix] = allowedIP.split('/');
        const prefixLength = parseInt(prefix, 10);
        
        // For simplicity, just check if the client IP starts with the network part
        // In a real implementation, you'd do proper CIDR matching
        if (prefixLength >= 24) {
          const networkPrefix = network.split('.').slice(0, 3).join('.');
          const clientPrefix = clientIP.split('.').slice(0, 3).join('.');
          return networkPrefix === clientPrefix;
        }
        return false;
      } else {
        // Exact IP match
        return clientIP === allowedIP;
      }
    });
  }

  private isAuthenticated(req: IncomingMessage): boolean {
    if (!this.config.authentication.enabled) {
      return true; // No authentication required
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return false;
    }

    try {
      const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const [username, password] = credentials.split(':');
      
      return username === this.config.authentication.username && 
             password === this.config.authentication.password;
    } catch {
      return false;
    }
  }

  private sendResponse(res: ServerResponse, statusCode: number, message: string): void {
    try {
      res.writeHead(statusCode);
      res.end(message);
    } catch (error) {
      // Handle response writing errors gracefully
      // In a real implementation, you might want to log this error
    }
  }
}