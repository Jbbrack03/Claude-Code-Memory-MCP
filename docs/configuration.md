# Configuration Guide

This guide covers all configuration options for the Claude Code Memory MCP Server, from basic setup to advanced production deployments.

## Configuration Overview

The server uses a hierarchical configuration system:

1. **Environment variables** (highest priority)
2. **`.env` file** in the project root
3. **Default values** (lowest priority)

## Basic Configuration

### Environment File (.env)

Create a `.env` file in your project root with the following structure:

```bash
# Environment
NODE_ENV=production                    # development | production | test
LOG_LEVEL=info                        # debug | info | warn | error

# Storage Configuration
SQLITE_PATH=.claude-memory/memory.db           # SQLite database path
VECTOR_PATH=.claude-memory/vectors            # Vector index storage path  
FILE_STORAGE_PATH=.claude-memory/files        # Large file storage path
SQLITE_WAL_MODE=true                          # Enable WAL mode for better concurrency

# Memory Limits
MAX_MEMORY_SIZE_MB=1000               # Maximum memory storage (1GB)
MAX_FILE_SIZE_MB=10                   # Maximum individual file size
MAX_VECTOR_COUNT=50000                # Maximum vectors in index

# Features
GIT_ENABLED=true                      # Enable Git integration
EMBEDDINGS_ENABLED=true               # Enable semantic search
MONITORING_ENABLED=true               # Enable monitoring and metrics
RATE_LIMITING_ENABLED=true            # Enable rate limiting

# Performance
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2      # Embedding model to use
BATCH_SIZE=100                        # Batch processing size
CACHE_TTL_SECONDS=3600               # Cache time-to-live
```

## Advanced Configuration

### Memory and Performance

```bash
# Memory Management
MEMORY_PRESSURE_THRESHOLD=0.8         # Memory pressure detection (80%)
EMERGENCY_CLEANUP_ENABLED=true        # Enable automatic cleanup
MEMORY_MONITORING_INTERVAL=5000       # Memory check interval (ms)

# Vector Index Performance
VECTOR_EF_CONSTRUCTION=200            # HNSW construction parameter
VECTOR_EF_SEARCH=50                   # HNSW search parameter
VECTOR_MAX_CONNECTIONS=16             # HNSW max connections per node

# Database Performance
SQLITE_CACHE_SIZE=10000               # SQLite cache size (pages)
SQLITE_BUSY_TIMEOUT=5000              # SQLite busy timeout (ms)
CONNECTION_POOL_SIZE=10               # Database connection pool size
```

### Git Integration

```bash
# Git Configuration
GIT_BRANCH_ISOLATION=true             # Isolate memories by branch
GIT_REMOTE_SYNC=true                  # Sync with remote repository
GIT_IGNORE_PATTERNS=node_modules,dist # Patterns to ignore
GIT_VALIDATION_ENABLED=true           # Validate memories against Git state
```

### Monitoring and Observability

```bash
# Metrics Collection
PROMETHEUS_ENABLED=true               # Enable Prometheus metrics
PROMETHEUS_PORT=9090                  # Metrics endpoint port
OPENTELEMETRY_ENABLED=true           # Enable distributed tracing
HEALTH_CHECK_INTERVAL=30000          # Health check interval (ms)

# Alerting
ALERT_WEBHOOKS=http://localhost:3000/alerts  # Webhook URLs (comma-separated)
ALERT_COOLDOWN_MS=300000             # Alert cooldown period (5 minutes)
ERROR_RATE_THRESHOLD=0.1             # Error rate threshold (10%)
```

### Security and Rate Limiting

```bash
# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000           # Rate limit window (1 minute)
RATE_LIMIT_MAX_REQUESTS=100          # Max requests per window
RATE_LIMIT_STRATEGY=sliding          # sliding | fixed

# Security
COMMAND_INJECTION_PREVENTION=true    # Enable command injection prevention
SENSITIVE_DATA_DETECTION=true        # Enable sensitive data detection
MAX_QUERY_LENGTH=1000               # Maximum query length
```

## MCP Server Configuration

### Claude Code settings.json

Add the MCP server configuration to your Claude Code settings:

```json
{
  "mcpServers": {
    "claude-memory": {
      "command": "claude-memory-server",
      "args": ["--config", "/path/to/.env"],
      "env": {
        "NODE_ENV": "production",
        "LOG_LEVEL": "info"
      },
      "timeout": 10000,
      "retries": 3
    }
  }
}
```

### Hook Configuration

Configure hooks for automatic memory capture and context injection:

```json
{
  "hooks": {
    "preToolUse": [
      {
        "description": "Inject context before file operations",
        "tools": ["Write", "Edit", "MultiEdit", "Read"],
        "command": "claude-memory inject-context --query=\"${tool.name} ${tool.input.file_path}\" --limit=5",
        "timeout": 5000,
        "retries": 2
      }
    ],
    "postToolUse": [
      {
        "description": "Capture file modifications",
        "tools": ["Write", "Edit", "MultiEdit"],
        "command": "claude-memory capture-event --type=file_write --content=\"Modified ${tool.input.file_path}\" --metadata='{\"file\":\"${tool.input.file_path}\"}'",
        "timeout": 3000,
        "retries": 1
      },
      {
        "description": "Capture important decisions",
        "tools": ["Bash"],
        "command": "claude-memory capture-event --type=command --content=\"Executed: ${tool.input.command}\" --metadata='{\"command\":\"${tool.input.command}\"}'",
        "timeout": 2000
      }
    ],
    "userPromptSubmit": [
      {
        "description": "Inject context based on user prompt",
        "command": "claude-memory inject-context --query=\"${prompt.text}\" --limit=10",
        "timeout": 5000,
        "retries": 2
      }
    ]
  }
}
```

## Production Configuration

### High Performance Setup

For production deployments requiring high performance:

```bash
# Production Environment
NODE_ENV=production
LOG_LEVEL=warn

# Optimized Memory Settings
MAX_MEMORY_SIZE_MB=4000
MEMORY_PRESSURE_THRESHOLD=0.7
BATCH_SIZE=500

# High-Performance Vector Settings
VECTOR_EF_CONSTRUCTION=400
VECTOR_EF_SEARCH=100
VECTOR_MAX_CONNECTIONS=32

# Database Optimization
SQLITE_CACHE_SIZE=50000
CONNECTION_POOL_SIZE=20
SQLITE_SYNCHRONOUS=NORMAL

# Monitoring (Essential for Production)
PROMETHEUS_ENABLED=true
OPENTELEMETRY_ENABLED=true
HEALTH_CHECK_INTERVAL=10000
```

### High Availability Setup

For high availability deployments:

```bash
# Backup and Recovery
BACKUP_ENABLED=true
BACKUP_INTERVAL=3600000              # Hourly backups
BACKUP_RETENTION_DAYS=30
BACKUP_PATH=.claude-memory/backups

# Redundancy
REPLICA_COUNT=2
REPLICA_SYNC_INTERVAL=60000

# Health Monitoring
HEALTH_CHECK_TIMEOUT=5000
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_THRESHOLD=10
```

## Configuration Validation

### Environment Variable Validation

The server validates all configuration on startup. Common validation errors:

- **Invalid paths**: Ensure storage directories exist and are writable
- **Resource limits**: Memory and file size limits must be positive integers
- **Model paths**: Embedding models must be accessible
- **Network settings**: Ports must be available and within valid ranges

### Testing Configuration

Test your configuration before deployment:

```bash
# Validate configuration
claude-memory config validate

# Test with dry-run mode
NODE_ENV=development claude-memory start --dry-run

# Check health after startup
claude-memory health --verbose
```

## Environment-Specific Configurations

### Development

```bash
NODE_ENV=development
LOG_LEVEL=debug
SQLITE_PATH=.claude-memory/dev.db
EMBEDDINGS_ENABLED=false              # Skip embeddings for faster startup
MONITORING_ENABLED=false
```

### Testing

```bash
NODE_ENV=test
LOG_LEVEL=error
SQLITE_PATH=:memory:                  # In-memory database
MAX_MEMORY_SIZE_MB=100                # Lower limits for tests
EMBEDDINGS_ENABLED=false
```

### Production

```bash
NODE_ENV=production
LOG_LEVEL=info
SQLITE_PATH=/var/lib/claude-memory/memory.db
MAX_MEMORY_SIZE_MB=2000
EMBEDDINGS_ENABLED=true
MONITORING_ENABLED=true
RATE_LIMITING_ENABLED=true
```

## Troubleshooting Configuration

### Common Configuration Issues

1. **Permission Errors**: Ensure the application has read/write access to all configured paths
2. **Memory Limits**: Increase system memory or reduce `MAX_MEMORY_SIZE_MB`
3. **Model Download Failures**: Check network connectivity and disk space
4. **Database Locks**: Enable WAL mode with `SQLITE_WAL_MODE=true`

### Configuration Debugging

Enable debug logging to troubleshoot configuration issues:

```bash
LOG_LEVEL=debug claude-memory start
```

For detailed troubleshooting, see the [Troubleshooting Guide](troubleshooting.md).