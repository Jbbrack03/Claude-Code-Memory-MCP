import { z } from "zod";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();


// Configuration schema
const ConfigSchema = z.object({
  // Server configuration
  server: z.object({
    name: z.string().default("claude-memory-mcp"),
    version: z.string().default("0.1.0"),
    mode: z.enum(["development", "production", "test"]).default("production"),
    logLevel: z.enum(["error", "warn", "info", "debug"]).default("info")
  }),

  // Storage configuration
  storage: z.object({
    // SQLite configuration
    sqlite: z.object({
      path: z.string().default(".claude-memory/memory.db"),
      walMode: z.boolean().default(true),
      busyTimeout: z.number().default(5000),
      cacheSize: z.number().default(2000)
    }),

    // Vector database configuration
    vector: z.object({
      provider: z.enum(["chromadb", "local"]).default("local"),
      path: z.string().default(".claude-memory/vectors"),
      dimension: z.number().default(384)
    }),

    // File storage configuration
    files: z.object({
      path: z.string().default(".claude-memory/files"),
      maxSize: z.string().default("100MB")
    }),

    // Memory limits
    limits: z.object({
      maxMemorySize: z.string().default("100MB"),
      maxMemoriesPerProject: z.number().default(100000),
      maxFileSize: z.string().default("10MB")
    })
  }),

  // Hook system configuration
  hooks: z.object({
    // Execution limits
    execution: z.object({
      timeout: z.number().default(5000), // 5 seconds
      maxMemory: z.string().default("100MB"),
      maxCpu: z.number().default(1)
    }),

    // Circuit breaker
    circuitBreaker: z.object({
      failureThreshold: z.number().default(5),
      resetTimeout: z.number().default(60000), // 1 minute
      halfOpenRequests: z.number().default(3)
    }),

    // Sandboxing
    sandbox: z.object({
      enabled: z.boolean().default(true),
      allowedCommands: z.array(z.string()).default([
        "claude-memory",
        "echo",
        "date"
      ]),
      env: z.record(z.string()).default({})
    })
  }),

  // Git integration configuration
  git: z.object({
    enabled: z.boolean().default(true),
    autoDetect: z.boolean().default(true),
    branch: z.string().optional(),
    remote: z.string().default("origin"),
    
    // Validation settings
    validation: z.object({
      checkInterval: z.number().default(30000), // 30 seconds
      validateOnStartup: z.boolean().default(true),
      reconcileOnConflict: z.boolean().default(true)
    })
  }),

  // Intelligence layer configuration
  intelligence: z.object({
    // Embedding configuration
    embeddings: z.object({
      model: z.string().default("all-MiniLM-L6-v2"),
      batchSize: z.number().default(32),
      cache: z.boolean().default(true)
    }),

    // Retrieval configuration
    retrieval: z.object({
      topK: z.number().default(10),
      minScore: z.number().default(0.7),
      rerank: z.boolean().default(true)
    }),

    // Context injection
    context: z.object({
      maxSize: z.number().default(15000), // 15KB
      includeMetadata: z.boolean().default(true),
      deduplication: z.boolean().default(true)
    })
  }),

  // Performance configuration
  performance: z.object({
    // Caching
    cache: z.object({
      enabled: z.boolean().default(true),
      ttl: z.number().default(300000), // 5 minutes
      maxSize: z.string().default("50MB")
    }),

    // Background tasks
    background: z.object({
      enabled: z.boolean().default(true),
      cleanupInterval: z.number().default(3600000), // 1 hour
      optimizeInterval: z.number().default(86400000) // 24 hours
    })
  }),

  // Security configuration
  security: z.object({
    // Secret detection
    secrets: z.object({
      detect: z.boolean().default(true),
      redact: z.boolean().default(true),
      patterns: z.array(z.string()).default([
        "api[_-]?key",
        "secret[_-]?key",
        "password",
        "token",
        "bearer"
      ])
    }),

    // Encryption
    encryption: z.object({
      enabled: z.boolean().default(true),
      algorithm: z.string().default("aes-256-gcm")
    })
  })
});

// Parse configuration from environment and defaults
function loadConfig() {
  const rawConfig = {
    server: {
      name: process.env.SERVER_NAME,
      version: process.env.SERVER_VERSION,
      mode: process.env.NODE_ENV || process.env.MEMORY_MODE,
      logLevel: process.env.LOG_LEVEL
    },
    storage: {
      sqlite: {
        path: process.env.SQLITE_PATH,
        walMode: process.env.SQLITE_WAL_MODE === "true",
        busyTimeout: process.env.SQLITE_BUSY_TIMEOUT ? parseInt(process.env.SQLITE_BUSY_TIMEOUT) : undefined,
        cacheSize: process.env.SQLITE_CACHE_SIZE ? parseInt(process.env.SQLITE_CACHE_SIZE) : undefined
      },
      vector: {
        provider: process.env.VECTOR_PROVIDER as any,
        path: process.env.VECTOR_PATH,
        dimension: process.env.VECTOR_DIMENSION ? parseInt(process.env.VECTOR_DIMENSION) : undefined
      },
      files: {
        path: process.env.FILES_PATH,
        maxSize: process.env.MAX_FILE_SIZE
      },
      limits: {
        maxMemorySize: process.env.MAX_MEMORY_SIZE,
        maxMemoriesPerProject: process.env.MAX_MEMORIES_PER_PROJECT ? parseInt(process.env.MAX_MEMORIES_PER_PROJECT) : undefined,
        maxFileSize: process.env.MAX_FILE_SIZE
      }
    },
    hooks: {
      execution: {
        timeout: process.env.HOOK_TIMEOUT ? parseInt(process.env.HOOK_TIMEOUT) : undefined,
        maxMemory: process.env.HOOK_MAX_MEMORY,
        maxCpu: process.env.HOOK_MAX_CPU ? parseInt(process.env.HOOK_MAX_CPU) : undefined
      },
      circuitBreaker: {
        failureThreshold: process.env.CIRCUIT_FAILURE_THRESHOLD ? parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD) : undefined,
        resetTimeout: process.env.CIRCUIT_RESET_TIMEOUT ? parseInt(process.env.CIRCUIT_RESET_TIMEOUT) : undefined,
        halfOpenRequests: process.env.CIRCUIT_HALF_OPEN_REQUESTS ? parseInt(process.env.CIRCUIT_HALF_OPEN_REQUESTS) : undefined
      },
      sandbox: {
        enabled: process.env.SANDBOX_ENABLED !== "false",
        allowedCommands: process.env.SANDBOX_ALLOWED_COMMANDS?.split(","),
        env: process.env.SANDBOX_ENV ? JSON.parse(process.env.SANDBOX_ENV) : undefined
      }
    },
    git: {
      enabled: process.env.GIT_INTEGRATION !== "false",
      autoDetect: process.env.GIT_AUTO_DETECT !== "false",
      branch: process.env.GIT_BRANCH,
      remote: process.env.GIT_REMOTE,
      validation: {
        checkInterval: process.env.GIT_CHECK_INTERVAL ? parseInt(process.env.GIT_CHECK_INTERVAL) : undefined,
        validateOnStartup: process.env.GIT_VALIDATE_ON_STARTUP !== "false",
        reconcileOnConflict: process.env.GIT_RECONCILE_ON_CONFLICT !== "false"
      }
    },
    intelligence: {
      embeddings: {
        model: process.env.EMBEDDINGS_MODEL,
        batchSize: process.env.EMBEDDINGS_BATCH_SIZE ? parseInt(process.env.EMBEDDINGS_BATCH_SIZE) : undefined,
        cache: process.env.EMBEDDINGS_CACHE !== "false"
      },
      retrieval: {
        topK: process.env.RETRIEVAL_TOP_K ? parseInt(process.env.RETRIEVAL_TOP_K) : undefined,
        minScore: process.env.RETRIEVAL_MIN_SCORE ? parseFloat(process.env.RETRIEVAL_MIN_SCORE) : undefined,
        rerank: process.env.RETRIEVAL_RERANK !== "false"
      },
      context: {
        maxSize: process.env.CONTEXT_MAX_SIZE ? parseInt(process.env.CONTEXT_MAX_SIZE) : undefined,
        includeMetadata: process.env.CONTEXT_INCLUDE_METADATA !== "false",
        deduplication: process.env.CONTEXT_DEDUPLICATION !== "false"
      }
    },
    performance: {
      cache: {
        enabled: process.env.CACHE_ENABLED !== "false",
        ttl: process.env.CACHE_TTL ? parseInt(process.env.CACHE_TTL) : undefined,
        maxSize: process.env.CACHE_MAX_SIZE
      },
      background: {
        enabled: process.env.BACKGROUND_TASKS_ENABLED !== "false",
        cleanupInterval: process.env.CLEANUP_INTERVAL ? parseInt(process.env.CLEANUP_INTERVAL) : undefined,
        optimizeInterval: process.env.OPTIMIZE_INTERVAL ? parseInt(process.env.OPTIMIZE_INTERVAL) : undefined
      }
    },
    security: {
      secrets: {
        detect: process.env.DETECT_SECRETS !== "false",
        redact: process.env.REDACT_SECRETS !== "false",
        patterns: process.env.SECRET_PATTERNS?.split(",")
      },
      encryption: {
        enabled: process.env.ENCRYPTION_ENABLED !== "false",
        algorithm: process.env.ENCRYPTION_ALGORITHM
      }
    }
  };

  // Remove undefined values
  const cleanConfig = JSON.parse(JSON.stringify(rawConfig));

  // Parse and validate configuration
  return ConfigSchema.parse(cleanConfig);
}

// Export configuration
export const config = loadConfig();

// Export types
export type Config = z.infer<typeof ConfigSchema>;