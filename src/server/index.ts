#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "../config/index.js";
import { StorageEngine } from "../storage/engine.js";
import { HookSystem } from "../hooks/system.js";
import { GitIntegration } from "../git/integration.js";
import { IntelligenceLayer } from "../intelligence/layer.js";
import { logger } from "../utils/logger.js";
import { ErrorHandler } from "../utils/error-handler.js";
// import { HealthChecker } from "../utils/health-checker.js"; // Using monitoring system health checks instead
import { GracefulDegradation } from "../utils/graceful-degradation.js";
import { RateLimiter } from "../utils/rate-limiter.js";
import { MonitoringSystem } from "../monitoring/index.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { SessionManager } from "../session/manager.js";

// Define metadata schema
const metadataSchema = z.record(z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
]));

// Initialize server
const server = new McpServer({
  name: "claude-memory-mcp",
  version: "0.1.0"
});

// Initialize subsystems
let storage: StorageEngine;
let hooks: HookSystem;
let git: GitIntegration;
let intelligence: IntelligenceLayer;
// let healthChecker: HealthChecker; // Unused for now
let monitoring: MonitoringSystem;
let workspaceManager: WorkspaceManager;
let sessionManager: SessionManager;

// Initialize rate limiters
const captureMemoryLimiter = new RateLimiter({
  maxRequests: 100,
  windowMs: 60000, // 1 minute
  keyPrefix: 'capture-memory',
  slidingWindow: true
});

const retrieveMemoriesLimiter = new RateLimiter({
  maxRequests: 100,
  windowMs: 60000, // 1 minute
  keyPrefix: 'retrieve-memories',
  slidingWindow: true
});

const buildContextLimiter = new RateLimiter({
  maxRequests: 100,
  windowMs: 60000, // 1 minute
  keyPrefix: 'build-context',
  slidingWindow: true
});

// Server initialization
async function initialize() {
  try {
    logger.info("Initializing Claude Memory MCP Server...");

    // Initialize monitoring system first
    monitoring = new MonitoringSystem({
      metrics: {
        enabled: config.monitoring.endpoint.enabled,
        prefix: config.monitoring.metrics.prefix,
        port: config.monitoring.endpoint.port
      },
      tracing: {
        enabled: config.monitoring.tracing.enabled,
        serviceName: config.monitoring.tracing.serviceName,
        endpoint: config.monitoring.tracing.endpoint
      },
      healthChecks: {
        enabled: config.monitoring.healthChecks.enabled,
        interval: config.monitoring.healthChecks.interval
      },
      alerting: {
        enabled: config.monitoring.alerting.enabled,
        checkInterval: config.monitoring.alerting.checkInterval
      }
    });
    await monitoring.initialize();

    // Initialize storage engine
    storage = new StorageEngine(config.storage);
    await storage.initialize();

    // Initialize hook system
    hooks = new HookSystem(config.hooks);
    hooks.initialize();

    // Initialize git integration
    git = new GitIntegration(config.git);
    await git.initialize();

    // Initialize intelligence layer with storage reference
    intelligence = new IntelligenceLayer(config.intelligence, storage);
    await intelligence.initialize();

    // Initialize workspace manager
    workspaceManager = new WorkspaceManager(git);
    
    // Initialize session manager
    sessionManager = new SessionManager({
      sessionTimeout: 30 * 60 * 1000, // 30 minutes
      maxActiveSessions: 50,
      persistSessions: true
    }, (storage as any).sqlite);

    // Initialize health checker
    // healthChecker = new HealthChecker({
    //   storage,
    //   hooks,
    //   git,
    //   intelligence
    // }); // Using monitoring system health checks instead

    // Integrate monitoring with subsystems
    monitoring.integrateWithStorage(storage);
    monitoring.integrateWithHooks(hooks);

    // Setup error handlers
    ErrorHandler.setupGlobalHandlers();

    // Register tools
    registerTools();

    // Register resources
    registerResources();

    logger.info("Server initialization complete");
  } catch (error) {
    logger.error("Failed to initialize server:", error);
    process.exit(1);
  }
}

// Register MCP tools
function registerTools() {
  // Memory capture tool
  server.registerTool(
    "capture-memory",
    {
      title: "Capture Memory",
      description: "Capture an event or memory from Claude Code",
      inputSchema: {
        eventType: z.string(),
        content: z.string(),
        metadata: metadataSchema.optional()
      }
    },
    async (args) => {
      const { eventType, content, metadata } = args;
      
      // Get workspace and session
      const workspaceId = await workspaceManager.detectWorkspace();
      const session = await sessionManager.getOrCreateSession(
        workspaceId, 
        process.env.SESSION_ID
      );
      
      return await monitoring.getInstrumentation().traceMemoryCapture(
        eventType,
        workspaceId,
        async () => {
          try {
            // Record operation start
            monitoring.getMetrics().recordMemoryCapture(eventType, 'success', workspaceId);
            
            // Check rate limit
            const rateLimitResult = await captureMemoryLimiter.checkLimit(session.id);
            
            if (!rateLimitResult.allowed) {
              monitoring.getMetrics().recordRateLimitExceeded('capture-memory', workspaceId);
              monitoring.getLogger().logRateLimitEvent('capture-memory', workspaceId, 'exceeded', {
                retryAfter: rateLimitResult.retryAfter
              });
              
              return {
                content: [{
                  type: "text" as const,
                  text: `Rate limit exceeded. Please retry after ${rateLimitResult.retryAfter} seconds.`
                }],
                isError: true
              };
            }
            
            // Check if memory capture is disabled
            if (GracefulDegradation.isFeatureDisabled('memory_capture')) {
              return GracefulDegradation.createDegradedResponse('memory_capture');
            }

            const timer = monitoring.getMetrics().startTimer('memory_capture');
            
            const memory = await storage.captureMemory({
              eventType,
              content,
              metadata,
              timestamp: new Date(),
              sessionId: session.id,
              workspaceId
            });

            timer.end('success');
            
            monitoring.getLogger().logMemoryOperation('capture', 'success', {
              workspaceId,
              eventType
            });

            return {
              content: [{
                type: "text" as const,
                text: `Memory captured: ${memory.id}`
              }]
            };
          } catch (error) {
            monitoring.getMetrics().recordMemoryCapture(eventType, 'error', workspaceId);
            monitoring.getMetrics().recordError('memory_capture', error instanceof Error ? error.name : 'unknown');
            
            monitoring.getLogger().logMemoryOperation('capture', 'error', {
              workspaceId,
              eventType,
              error: error instanceof Error ? error : new Error('Unknown error')
            });
            
            // Handle storage failure gracefully
            if (error instanceof Error && error.message.includes('storage')) {
              GracefulDegradation.handleStorageFailure(error);
              return GracefulDegradation.createDegradedResponse('memory_capture');
            }
            
            return {
              content: [{
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`
              }],
              isError: true
            };
          }
        }
      );
    }
  );

  // Memory retrieval tool
  server.registerTool(
    "retrieve-memories",
    {
      title: "Retrieve Memories",
      description: "Retrieve relevant memories based on context",
      inputSchema: {
        query: z.string(),
        limit: z.number().optional().default(10),
        filters: metadataSchema.optional()
      }
    },
    async (args) => {
      const { query, limit, filters } = args;
      try {
        // Get workspace and session
        const workspaceId = await workspaceManager.detectWorkspace();
        const session = await sessionManager.getOrCreateSession(
          workspaceId,
          process.env.SESSION_ID
        );
        
        // Check rate limit
        const rateLimitResult = await retrieveMemoriesLimiter.checkLimit(session.id);
        
        if (!rateLimitResult.allowed) {
          return {
            content: [{
              type: "text" as const,
              text: `Rate limit exceeded. Please retry after ${rateLimitResult.retryAfter} seconds.`
            }],
            isError: true
          };
        }
        
        const memories = await intelligence.retrieveMemories(query, {
          limit,
          filters: {
            ...filters,
            workspaceId,
            sessionId: session.id
          }
        });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(memories, null, 2)
          }]
        };
      } catch (error) {
        logger.error("Failed to retrieve memories:", error);
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`
          }],
          isError: true
        };
      }
    }
  );

  // Git state tool
  server.registerTool(
    "git-state",
    {
      title: "Git State",
      description: "Get current Git repository state",
      inputSchema: {}
    },
    async () => {
      try {
        const state = await git.getCurrentState();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(state, null, 2)
          }]
        };
      } catch (error) {
        logger.error("Failed to get git state:", error);
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`
          }],
          isError: true
        };
      }
    }
  );

  // Build context tool
  server.registerTool(
    "build-context",
    {
      title: "Build Context",
      description: "Build formatted context from memories for injection",
      inputSchema: {
        query: z.string(),
        limit: z.number().optional().default(10),
        filters: metadataSchema.optional()
      }
    },
    async (args) => {
      const { query, limit, filters } = args;
      try {
        // Get workspace and session
        const workspaceId = await workspaceManager.detectWorkspace();
        const session = await sessionManager.getOrCreateSession(
          workspaceId,
          process.env.SESSION_ID
        );
        
        // Check rate limit
        const rateLimitResult = await buildContextLimiter.checkLimit(session.id);
        
        if (!rateLimitResult.allowed) {
          return {
            content: [{
              type: "text" as const,
              text: `Rate limit exceeded. Please retry after ${rateLimitResult.retryAfter} seconds.`
            }],
            isError: true
          };
        }
        
        // Check if context building is disabled
        if (GracefulDegradation.isFeatureDisabled('context_building')) {
          return GracefulDegradation.createDegradedResponse('context_building');
        }

        // First retrieve relevant memories
        const memories = await intelligence.retrieveMemories(query, {
          limit,
          filters: {
            ...filters,
            workspaceId,
            sessionId: session.id
          }
        });
        
        // Then build context from them
        const context = await intelligence.buildContext(memories);
        
        return {
          content: [{
            type: "text" as const,
            text: context
          }]
        };
      } catch (error) {
        logger.error("Failed to build context:", error);
        
        // Handle intelligence failure gracefully
        if (error instanceof Error && error.message.includes('intelligence')) {
          GracefulDegradation.handleIntelligenceFailure(error);
          return GracefulDegradation.createDegradedResponse('context_building');
        }
        
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`
          }],
          isError: true
        };
      }
    }
  );

  // Health check tool
  server.registerTool(
    "health-check",
    {
      title: "Health Check",
      description: "Check system health and component status",
      inputSchema: {
        detailed: z.boolean().optional().default(false)
      }
    },
    async (args) => {
      const { detailed } = args;
      try {
        if (detailed) {
          // Use the monitoring system's comprehensive health check
          const report = await monitoring.getHealthCheck().performHealthCheck();
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(report, null, 2)
            }]
          };
        } else {
          // Use the monitoring system's quick status check
          const quick = await monitoring.getHealthCheck().getQuickStatus();
          return {
            content: [{
              type: "text" as const,
              text: `System ${quick.status} - Uptime: ${Math.round(quick.uptime / 1000)}s - Memory: ${Math.round(quick.memory / 1024 / 1024)}MB`
            }]
          };
        }
      } catch (error) {
        monitoring.getLogger().error("Health check failed", error instanceof Error ? error : new Error(String(error)));
        monitoring.getMetrics().recordError('health_check', error instanceof Error ? error.name : 'unknown');
        
        return {
          content: [{
            type: "text" as const,
            text: `Health check error: ${error instanceof Error ? error.message : "Unknown error"}`
          }],
          isError: true
        };
      }
    }
  );
}

// Register MCP resources
function registerResources() {
  // Memory statistics resource
  server.registerResource(
    "memory-stats",
    "memory://stats",
    {
      title: "Memory Statistics",
      description: "Current memory storage statistics",
      mimeType: "application/json"
    },
    (uri) => {
      try {
        const stats = storage.getStatistics();
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify(stats, null, 2),
            mimeType: "application/json"
          }]
        };
      } catch (error) {
        logger.error("Failed to get memory stats:", error);
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
            mimeType: "application/json"
          }]
        };
      }
    }
  );

  // Configuration resource
  server.registerResource(
    "config",
    "config://current",
    {
      title: "Current Configuration",
      description: "Active server configuration (sanitized)",
      mimeType: "application/json"
    },
    (uri) => {
      const sanitizedConfig = {
        ...config,
        // Remove sensitive information
        storage: { ...config.storage, password: undefined },
        git: { ...config.git, credentials: undefined }
      };

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(sanitizedConfig, null, 2),
          mimeType: "application/json"
        }]
      };
    }
  );
}

// Main execution
async function main() {
  try {
    // Initialize server
    await initialize();

    // Create transport
    const transport = new StdioServerTransport();

    // Connect server to transport
    await server.connect(transport);

    logger.info("Claude Memory MCP Server is running");

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      logger.info("Shutting down server...");
      void cleanup().then(() => process.exit(0));
    });

    process.on("SIGTERM", () => {
      logger.info("Shutting down server...");
      void cleanup().then(() => process.exit(0));
    });

  } catch (error) {
    logger.error("Server startup failed:", error);
    process.exit(1);
  }
}

// Cleanup function
async function cleanup() {
  try {
    monitoring?.getLogger().logSystemEvent('shutdown', 'start');
    
    await storage?.close();
    hooks?.close();
    await git?.close();
    await intelligence?.close();
    workspaceManager?.clearCache();
    sessionManager?.close();
    
    // Shutdown monitoring system last
    await monitoring?.shutdown();
    
    logger.info("Cleanup completed successfully");
  } catch (error) {
    logger.error("Error during cleanup:", error);
    monitoring?.getLogger().logSystemEvent('shutdown', 'error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Run the server
main().catch((error) => {
  logger.error("Unhandled error:", error);
  process.exit(1);
});