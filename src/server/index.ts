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
import { HealthChecker } from "../utils/health-checker.js";
import { GracefulDegradation } from "../utils/graceful-degradation.js";
import { RateLimiter } from "../utils/rate-limiter.js";

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
let healthChecker: HealthChecker;

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

    // Initialize health checker
    healthChecker = new HealthChecker({
      storage,
      hooks,
      git,
      intelligence
    });

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
      try {
        // Check rate limit
        const sessionId = process.env.SESSION_ID || "default";
        const rateLimitResult = await captureMemoryLimiter.checkLimit(sessionId);
        
        if (!rateLimitResult.allowed) {
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

        const memory = await storage.captureMemory({
          eventType,
          content,
          metadata,
          timestamp: new Date(),
          sessionId: process.env.SESSION_ID || "default"
        });

        return {
          content: [{
            type: "text" as const,
            text: `Memory captured: ${memory.id}`
          }]
        };
      } catch (error) {
        logger.error("Failed to capture memory:", error);
        
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
        // Check rate limit
        const sessionId = process.env.SESSION_ID || "default";
        const rateLimitResult = await retrieveMemoriesLimiter.checkLimit(sessionId);
        
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
          filters
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
        // Check rate limit
        const sessionId = process.env.SESSION_ID || "default";
        const rateLimitResult = await buildContextLimiter.checkLimit(sessionId);
        
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
          filters
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
          const report = await healthChecker.checkHealth();
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(report, null, 2)
            }]
          };
        } else {
          const quick = await healthChecker.quickCheck();
          return {
            content: [{
              type: "text" as const,
              text: `System ${quick.healthy ? 'healthy' : 'unhealthy'}${quick.message ? ': ' + quick.message : ''}`
            }]
          };
        }
      } catch (error) {
        logger.error("Health check failed:", error);
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
    await storage?.close();
    hooks?.close();
    await git?.close();
    await intelligence?.close();
  } catch (error) {
    logger.error("Error during cleanup:", error);
  }
}

// Run the server
main().catch((error) => {
  logger.error("Unhandled error:", error);
  process.exit(1);
});