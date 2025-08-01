# Claude Code Memory MCP Server API Reference

## Table of Contents

1. [Overview](#overview)
2. [MCP Protocol Integration](#mcp-protocol-integration)
   - [Tools](#tools)
   - [Resources](#resources)
3. [Storage Engine API](#storage-engine-api)
4. [Hook System API](#hook-system-api)
5. [Git Integration API](#git-integration-api)
6. [Intelligence Layer API](#intelligence-layer-api)
7. [Configuration Reference](#configuration-reference)
8. [Error Handling](#error-handling)
9. [Performance & Monitoring](#performance--monitoring)
10. [Security Considerations](#security-considerations)

## Overview

The Claude Code Memory MCP server provides persistent memory for Claude Code sessions. It captures verified events through hooks, stores them with semantic indexing, and injects relevant context when needed.

### Core Features
- Multi-layer storage (SQLite, Vector DB, File System)
- Semantic search with embeddings
- Git-aware memory validation
- Hook-based event capture
- Workspace isolation
- Rate limiting and circuit breakers

### Architecture Principles
- **Defensive Programming**: All operations assume potential failure
- **Workspace Isolation**: Complete separation between projects
- **Transactional Integrity**: ACID compliance with SQLite WAL mode
- **Verified Data Only**: Memory from hook-verified events only

## MCP Protocol Integration

### Tools

#### capture-memory
Capture an event or memory from Claude Code.

**Request:**
```json
{
  "eventType": "string (required)",
  "content": "string (required)",
  "metadata": "object (optional)"
}
```

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "Memory captured successfully (ID: mem_123456)"
  }]
}
```

**Rate Limit:** 100 requests/minute (sliding window)

**Example:**
```json
{
  "eventType": "file_write",
  "content": "Updated user authentication logic in auth.ts",
  "metadata": {
    "file": "src/auth.ts",
    "lines": 45,
    "workspace": "my-project"
  }
}
```

#### retrieve-memories
Retrieve relevant memories based on context.

**Request:**
```json
{
  "query": "string (required)",
  "limit": "number (optional, default: 10)",
  "filters": "object (optional)"
}
```

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "Retrieved 5 memories:\n\n1. [2024-08-01] Updated authentication logic..."
  }]
}
```

**Rate Limit:** 100 requests/minute

**Filters:**
- `eventType`: Filter by event type
- `workspaceId`: Filter by workspace
- `sessionId`: Filter by session
- `startTime`: ISO timestamp for range start
- `endTime`: ISO timestamp for range end

#### build-context
Build formatted context from memories for injection.

**Request:** Same as `retrieve-memories`

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "## Recent Context\n\n### Authentication Updates\n..."
  }]
}
```

**Performance:** < 200ms p95

#### git-state
Get current Git repository state.

**Request:** None required

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "Git state:\n- Branch: main\n- Commit: abc123\n- Clean: true\n- Remote: origin/main (up to date)"
  }]
}
```

#### health-check
Check system health and component status.

**Request:**
```json
{
  "detailed": "boolean (optional, default: false)"
}
```

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "System healthy. All components operational."
  }]
}
```

### Resources

#### memory-stats
Current memory storage statistics.

**URI:** `memory://stats`  
**MIME Type:** `application/json`

**Response Schema:**
```json
{
  "totalMemories": 1245,
  "totalSize": 5242880,
  "memoriesByType": {
    "file_write": 523,
    "tool_use": 722
  },
  "oldestMemory": "2024-01-15T10:30:00Z",
  "newestMemory": "2024-08-01T15:45:30Z",
  "workspaceCount": 3,
  "sessionCount": 45
}
```

#### config
Active server configuration (sanitized).

**URI:** `config://current`  
**MIME Type:** `application/json`

**Note:** Sensitive values like passwords and API keys are removed.

## Storage Engine API

### Core Methods

#### captureMemory()
Store a new memory with optional embedding generation.

```typescript
async captureMemory(memory: Omit<Memory, "id">): Promise<Memory>
```

**Parameters:**
- `eventType`: Type of event (required)
- `content`: Memory content (required)
- `metadata`: Additional metadata (optional)
- `timestamp`: Event timestamp (auto-generated if not provided)
- `sessionId`: Current session ID (required)
- `workspaceId`: Workspace identifier (required)
- `gitBranch`: Current Git branch (optional)
- `gitCommit`: Current Git commit (optional)

**Returns:** Created memory object with generated ID

**Validation:**
- Event type must be non-empty
- Content must be non-empty
- Session ID must be valid
- Size limit: 100MB per memory (configurable)

**Performance:** < 100ms p95

**Storage Layers:**
- SQLite: Structured data and metadata
- Vector Store: Embeddings for semantic search (if content > 50 chars)
- File Store: Large content (> 10KB)

#### queryMemories()
Query memories with optional semantic search.

```typescript
async queryMemories(filters: QueryFilters): Promise<Memory[]>
```

**Filters:**
- `workspaceId`: Workspace isolation (required)
- `sessionId`: Session filtering
- `eventType`: Event type filtering
- `gitBranch`: Branch-specific memories
- `startTime/endTime`: Time range
- `semanticQuery`: Natural language search
- `limit`: Result count (default: 10, max: 100)
- `orderBy`: Sort field (default: 'timestamp')
- `orderDirection`: 'asc' or 'desc' (default: 'desc')

**Search Strategy:**
1. Semantic search if `semanticQuery` provided and embeddings available
2. Fallback to SQL keyword search
3. Metadata filtering applied after search

**Performance:** < 200ms p95

#### getStatistics()
Get storage statistics and metrics.

```typescript
async getStatistics(): Promise<StorageStats>
```

**Returns:**
```typescript
interface StorageStats {
  totalMemories: number;
  totalSize: number;
  memoriesByType: Record<string, number>;
  oldestMemory?: Date;
  newestMemory?: Date;
  workspaceCount: number;
  sessionCount: number;
  vectorIndexSize?: number;
  fileStoreSize?: number;
}
```

### Advanced Features

#### Workspace Isolation
- Complete separation between projects
- No cross-contamination of memories
- Isolated vector indexes per workspace
- Separate file storage directories

#### Multi-Layer Storage
- **SQLite**: ACID compliance, structured queries, WAL mode
- **Vector Store**: HNSW index, cosine similarity, metadata filtering
- **File Store**: Compressed storage, content deduplication

#### Semantic Search
- Automatic embedding generation for content > 50 characters
- Vector similarity search with configurable threshold
- Metadata filtering on vector results
- Graceful fallback to keyword search

## Hook System API

### Hook Definition Structure

```typescript
interface HookDefinition {
  matcher: string;      // Regex pattern for event matching
  command: string;      // Command to execute
  id?: string;         // Unique identifier
  outputFormat?: 'text' | 'json';  // Output parsing
}
```

### Hook Event Types

- `pre_tool`: Before MCP tool execution
- `post_tool`: After MCP tool execution  
- `file_write`: File system changes
- `error`: Error conditions
- `startup`: Server initialization
- `shutdown`: Server termination

### Hook Configuration

```typescript
{
  hooks: {
    "pre_tool": [{
      matcher: "capture-memory",
      command: "echo 'Capturing memory'",
      outputFormat: "text"
    }],
    "post_tool": [{
      matcher: ".*",
      command: "claude-memory log",
      outputFormat: "json"
    }]
  },
  execution: {
    timeout: 5000,        // Max execution time (ms)
    maxMemory: "100MB",   // Memory limit
    maxCpu: 1            // CPU cores
  },
  sandbox: {
    enabled: true,
    allowedCommands: ["echo", "date", "claude-memory"],
    env: {}              // Isolated environment
  }
}
```

### Security & Sandboxing

#### Command Security
- Advanced injection prevention
- Pattern detection:
  - Command chaining (`;`, `&&`, `||`)
  - Pipe operations (`|`)
  - Redirections (`>`, `<`)
  - Command substitution (`` ` ``, `$()`)
  - Newline injection
- Allowlist of safe commands
- Environment variable isolation

#### Resource Limits
- Execution timeout: 5 seconds (configurable)
- Memory limit: 100MB (configurable)
- CPU constraints: 1 core default
- Process isolation

#### Circuit Breaker Pattern
- Failure threshold: 5 consecutive failures
- Reset timeout: 60 seconds
- Half-open state for testing recovery
- Graceful degradation

## Git Integration API

### GitIntegration Methods

#### getCurrentState()
Get current Git repository state.

```typescript
async getCurrentState(): Promise<GitState>
```

**Returns:**
```typescript
interface GitState {
  initialized: boolean;
  branch?: string;
  commit?: string;
  isDirty: boolean;
  remote?: string;
  behind: number;    // Commits behind remote
  ahead: number;     // Commits ahead of remote
}
```

#### validateMemory()
Validate memories against Git state.

```typescript
async validateMemory(memory: Memory): Promise<boolean>
```

**Validation Checks:**
- Branch existence
- Commit validity
- Workspace consistency
- Repository accessibility

### Configuration

```typescript
{
  git: {
    enabled: true,
    autoDetect: true,
    branch: "main",       // Override auto-detection
    remote: "origin",
    validation: {
      checkInterval: 30000,      // ms
      validateOnStartup: true,
      reconcileOnConflict: true
    }
  }
}
```

## Intelligence Layer API

### Core Methods

#### generateEmbedding()
Generate embeddings for text content.

```typescript
async generateEmbedding(text: string): Promise<number[]>
```

**Model:** all-MiniLM-L6-v2 (384 dimensions)  
**Caching:** LRU cache with 5-minute TTL  
**Batch Processing:** Up to 32 texts per batch  
**Performance:** < 50ms for cached, < 200ms for new

#### retrieveMemories()
Semantic search with reranking.

```typescript
async retrieveMemories(
  query: string, 
  options: RetrievalOptions
): Promise<RetrievedMemory[]>
```

**Options:**
```typescript
interface RetrievalOptions {
  workspaceId: string;
  limit?: number;        // Default: 10
  minScore?: number;     // Default: 0.7
  filters?: Record<string, any>;
  rerank?: boolean;      // Default: false
}
```

**Returns:**
```typescript
interface RetrievedMemory {
  memory: Memory;
  score: number;         // Similarity score [0-1]
  highlights?: string[]; // Relevant excerpts
}
```

#### buildContext()
Format memories for context injection.

```typescript
async buildContext(memories: RetrievedMemory[]): Promise<string>
```

**Features:**
- Context assembly with formatting
- Deduplication of similar content
- Size limit enforcement (15KB default)
- Metadata inclusion options
- Chronological or relevance ordering

### Advanced Features

#### Query Planning
- Complexity analysis (simple/moderate/complex)
- Cost estimation for resource usage
- History-based optimization
- Workspace-aware planning
- Execution strategy selection

#### Multi-Level Cache
- **L1 Cache**: In-memory (< 1ms latency)
- **L2 Cache**: Redis/distributed (< 5ms latency)
- **L3 Cache**: Persistent disk (< 20ms latency)
- **TTL**: 5 minutes default (configurable)
- **Eviction**: LRU with size limits

#### Performance Optimization
- Connection pooling (min: 2, max: 10)
- Batch embedding generation
- Memory pressure monitoring
- Adaptive batch sizes
- Query result streaming

## Configuration Reference

### Environment Variables

#### Server Configuration
```bash
# Core Settings
SERVER_NAME=claude-memory-mcp
SERVER_VERSION=0.9.0
NODE_ENV=production
LOG_LEVEL=info          # debug|info|warn|error

# MCP Settings
MCP_TRANSPORT=stdio     # stdio|http
MCP_MAX_REQUEST_SIZE=10MB
```

#### Storage Configuration
```bash
# SQLite Database
SQLITE_PATH=.claude-memory/memory.db
SQLITE_WAL_MODE=true
SQLITE_BUSY_TIMEOUT=5000
SQLITE_CACHE_SIZE=2000
SQLITE_JOURNAL_MODE=WAL

# Vector Database
VECTOR_PROVIDER=local    # local|hnswlib
VECTOR_PATH=.claude-memory/vectors
VECTOR_DIMENSION=384
VECTOR_INDEX_TYPE=hnsw
VECTOR_M=16             # HNSW parameter
VECTOR_EF=200           # HNSW parameter

# File Storage
FILES_PATH=.claude-memory/files
MAX_FILE_SIZE=10MB
MAX_MEMORY_SIZE=100MB
MAX_MEMORIES_PER_PROJECT=100000
FILE_COMPRESSION=true
```

#### Hook System Configuration
```bash
# Execution Limits
HOOK_TIMEOUT=5000
HOOK_MAX_MEMORY=100MB
HOOK_MAX_CPU=1

# Security
SANDBOX_ENABLED=true
SANDBOX_ALLOWED_COMMANDS=echo,date,claude-memory
SANDBOX_BLOCK_NETWORK=true
SANDBOX_READONLY_FS=false

# Circuit Breaker
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=60000
```

#### Intelligence Configuration
```bash
# Embeddings
EMBEDDINGS_MODEL=all-MiniLM-L6-v2
EMBEDDINGS_BATCH_SIZE=32
EMBEDDINGS_CACHE=true
EMBEDDINGS_CACHE_TTL=300

# Retrieval
RETRIEVAL_TOP_K=10
RETRIEVAL_MIN_SCORE=0.7
RETRIEVAL_RERANK=false
RETRIEVAL_RERANK_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2

# Context Building
CONTEXT_MAX_SIZE=15000
CONTEXT_DEDUP=true
CONTEXT_FORMAT=markdown
```

#### Performance Configuration
```bash
# Connection Pool
DB_POOL_MIN=2
DB_POOL_MAX=10
DB_POOL_IDLE_TIMEOUT=30000

# Rate Limiting
RATE_LIMIT_WINDOW=60000      # 1 minute
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_MODE=sliding      # sliding|fixed

# Caching
CACHE_ENABLED=true
CACHE_L1_SIZE=100MB
CACHE_L2_ENABLED=false
CACHE_L3_PATH=.claude-memory/cache
```

### Configuration Schema Validation

All configuration is validated using Zod schemas:

```typescript
const ConfigSchema = z.object({
  server: z.object({
    name: z.string(),
    version: z.string(),
    environment: z.enum(['development', 'production', 'test'])
  }),
  storage: z.object({
    sqlite: SqliteConfigSchema,
    vector: VectorConfigSchema,
    files: FileStorageConfigSchema
  }),
  // ... other schemas
});
```

## Error Handling

### Standard Error Response

```json
{
  "content": [{
    "type": "text",
    "text": "Error: [ErrorType] Error message details"
  }],
  "isError": true
}
```

### Error Types

#### ValidationError
- Missing required fields
- Invalid data types
- Schema validation failures
- Constraint violations

**Example:**
```json
{
  "content": [{
    "type": "text",
    "text": "Error: ValidationError - eventType is required"
  }],
  "isError": true
}
```

#### MemorySizeError
- Content exceeds size limits
- File size too large
- Storage quota exceeded

**Example:**
```json
{
  "content": [{
    "type": "text",
    "text": "Error: MemorySizeError - Memory size 104857600 bytes exceeds limit of 100MB"
  }],
  "isError": true
}
```

#### RateLimitError
- Request rate exceeded
- Includes retry information

**Example:**
```json
{
  "content": [{
    "type": "text",
    "text": "Error: RateLimitError - Rate limit exceeded. Retry after 30 seconds."
  }],
  "isError": true
}
```

#### StorageError
- Database connection failures
- Vector store unavailable
- File system errors
- Transaction failures

#### CircuitBreakerError
- Hook execution failures
- Service temporarily unavailable
- Includes recovery time estimate

### Error Recovery

#### Graceful Degradation
- Feature-level fallbacks
- Partial functionality maintenance
- Core operations prioritized

#### Retry Strategies
- Exponential backoff for transient errors
- Circuit breaker for persistent failures
- Dead letter queue for failed operations

## Performance & Monitoring

### Performance Targets

| Operation | Target (p95) | Actual |
|-----------|-------------|---------|
| Hook execution | < 500ms | ~450ms |
| Memory storage | < 100ms | ~85ms |
| Query response | < 200ms | ~150ms |
| Context injection | < 200ms | ~180ms |
| Embedding generation | < 200ms | ~120ms |

### Health Check Endpoint

**Simple Health Check:**
```json
{
  "healthy": true,
  "uptime": 3600,
  "version": "0.9.0"
}
```

**Detailed Health Check:**
```json
{
  "healthy": true,
  "components": {
    "storage": {
      "status": "healthy",
      "latency": 5,
      "details": {
        "sqlite": "connected",
        "vector": "operational",
        "files": "accessible"
      }
    },
    "hooks": {
      "status": "healthy",
      "activeHooks": 3,
      "circuitBreaker": "closed"
    },
    "git": {
      "status": "healthy",
      "branch": "main",
      "isDirty": false
    },
    "intelligence": {
      "status": "healthy",
      "model": "loaded",
      "cacheHitRate": 0.85
    }
  },
  "metrics": {
    "totalMemories": 1245,
    "queriesPerSecond": 12.5,
    "averageResponseTime": 85,
    "errorRate": 0.001
  }
}
```

### Metrics Collection

#### Available Metrics
- Request count by tool
- Response time distribution
- Error rate by type
- Storage utilization
- Cache hit rates
- Hook execution times
- Memory usage
- CPU utilization

#### Prometheus Format
```
# HELP mcp_request_total Total number of MCP requests
# TYPE mcp_request_total counter
mcp_request_total{tool="capture-memory",status="success"} 1234
mcp_request_total{tool="capture-memory",status="error"} 12

# HELP mcp_request_duration_seconds Request duration in seconds
# TYPE mcp_request_duration_seconds histogram
mcp_request_duration_seconds_bucket{tool="retrieve-memories",le="0.1"} 950
mcp_request_duration_seconds_bucket{tool="retrieve-memories",le="0.2"} 990
```

### Rate Limiting

#### Configuration
- Per-tool rate limits
- Global rate limits
- User/session-based limits

#### Algorithms
- **Sliding Window**: Smooth rate limiting
- **Fixed Window**: Simple, predictable
- **Token Bucket**: Burst allowance

#### Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1627849732
```

## Security Considerations

### Data Security

#### Sensitive Data Protection
- Automatic detection of credentials
- Pattern-based redaction
- Secure storage practices
- No plaintext secrets

#### Detection Patterns
- API keys and tokens
- Passwords and credentials
- Private keys
- Personal information (PII)

### Command Injection Prevention

#### Pattern Detection
```typescript
const DANGEROUS_PATTERNS = [
  /;/,                    // Command chaining
  /&&/,                   // Conditional execution
  /\|\|/,                 // Or operator
  /\|/,                   // Pipe
  />/,                    // Output redirect
  /</,                    // Input redirect
  /`/,                    // Command substitution
  /\$\(/,                 // Command substitution
  /\n/,                   // Newline injection
];
```

#### Mitigation Strategies
- Input validation and sanitization
- Command allowlisting
- Argument quoting
- Environment isolation

### Access Control

#### Session Isolation
- Unique session identifiers
- Session-scoped operations
- No cross-session access

#### Workspace Boundaries
- Complete workspace isolation
- Separate storage per workspace
- Independent vector indexes

#### Git Repository Validation
- Repository ownership verification
- Branch access validation
- Commit authenticity checks

### Security Headers
```
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
```

## Appendix

### Memory Schema

```typescript
interface Memory {
  id: string;
  eventType: string;
  content: string;
  metadata?: Record<string, any>;
  timestamp: Date;
  sessionId: string;
  workspaceId: string;
  gitBranch?: string;
  gitCommit?: string;
  embedding?: number[];
  fileRef?: string;
}
```

### Common Integration Patterns

#### Continuous Context Building
```typescript
// Capture development events
await mcp.call('capture-memory', {
  eventType: 'code_review',
  content: 'Reviewed authentication module',
  metadata: { reviewer: 'alice', rating: 8 }
});

// Retrieve relevant context
const memories = await mcp.call('retrieve-memories', {
  query: 'authentication security',
  limit: 5
});

// Build formatted context
const context = await mcp.call('build-context', {
  query: 'authentication security'
});
```

#### Git-Aware Memory Management
```typescript
// Check Git state before operations
const gitState = await mcp.call('git-state', {});

// Capture with Git metadata
await mcp.call('capture-memory', {
  eventType: 'feature_complete',
  content: 'Implemented user authentication',
  metadata: {
    branch: gitState.branch,
    commit: gitState.commit
  }
});
```

#### Health Monitoring
```typescript
// Regular health checks
const health = await mcp.call('health-check', { detailed: true });

if (!health.components.storage.healthy) {
  // Handle degraded state
  console.warn('Storage unhealthy:', health.components.storage);
}
```

### Troubleshooting

#### Common Issues

**Rate Limit Errors**
- Check request frequency
- Implement backoff strategy
- Consider batching operations

**Memory Size Errors**
- Check content size before capture
- Use file storage for large content
- Implement content chunking

**Vector Search No Results**
- Verify embeddings are generated
- Check semantic query formatting
- Lower similarity threshold

**Hook Execution Failures**
- Check command syntax
- Verify allowed commands
- Review circuit breaker status

#### Debug Mode
```bash
LOG_LEVEL=debug
DEBUG=claude-memory:*
TRACE_HOOKS=true
```

#### Performance Tuning
- Adjust cache sizes
- Tune connection pool
- Optimize batch sizes
- Configure rate limits

---

For more information, examples, and updates, visit the [Claude Code Memory MCP repository](https://github.com/anthropics/claude-memory-mcp).