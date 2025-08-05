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
7. [Workspace Management API](#workspace-management-api)
   - [WorkspaceManager](#workspacemanager)
8. [Session Management API](#session-management-api)
   - [SessionManager](#sessionmanager)
9. [Configuration Reference](#configuration-reference)
10. [Error Handling](#error-handling)
11. [Performance & Monitoring](#performance--monitoring)
12. [Security Considerations](#security-considerations)

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

## Workspace Management API

### WorkspaceManager

The WorkspaceManager handles workspace detection, initialization, and metadata management. It ensures complete isolation between different projects and provides workspace-specific configuration.

#### Constructor

```typescript
constructor(git?: GitIntegration)
```

**Parameters:**
- `git`: Optional GitIntegration instance for enhanced Git repository detection

#### detectWorkspace()
Automatically detect and initialize workspace from a given path. Uses intelligent detection to identify Git repositories, NPM packages, or fallback to directory-based workspaces.

```typescript
async detectWorkspace(startPath?: string): Promise<string>
```

**Parameters:**
- `startPath`: Optional file system path to detect workspace from (defaults to current working directory)

**Returns:**
- `string`: Absolute path to the detected workspace root

**Detection Priority:**
1. **Git Repository**: Searches for `.git` directory up the directory tree
2. **NPM Package**: Searches for `package.json` up the directory tree
3. **Directory**: Falls back to the provided directory as workspace

**Example:**
```typescript
const manager = new WorkspaceManager();
const workspacePath = await manager.detectWorkspace('/Users/project/src');
// Returns: '/Users/project' (if it's a git repo)
```

#### initializeWorkspace()
Initialize a workspace by detecting its type and caching its metadata.

```typescript
async initializeWorkspace(workspacePath: string): Promise<void>
```

**Parameters:**
- `workspacePath`: Absolute path to the workspace to initialize

**Throws:**
- `Error`: If workspace path doesn't exist

**Example:**
```typescript
await manager.initializeWorkspace('/Users/project');
// Workspace is now detected and cached
```

#### getWorkspaceMetadata()
Retrieve metadata for a workspace, including type, name, and source control information.

```typescript
async getWorkspaceMetadata(workspaceId: string): Promise<WorkspaceMetadata>
```

**Parameters:**
- `workspaceId`: Workspace path/identifier

**Returns:**
```typescript
interface WorkspaceMetadata {
  id: string;                    // Workspace identifier (path)
  type: 'git' | 'npm' | 'directory';  // Workspace type
  name: string;                  // Human-readable name
  gitRemote?: string;            // Git remote URL (if git workspace)
  packageName?: string;          // NPM package name (if npm workspace)
  detectedAt: Date;              // When workspace was first detected
}
```

**Example:**
```typescript
const metadata = await manager.getWorkspaceMetadata('/Users/project');
console.log(metadata);
// {
//   id: '/Users/project',
//   type: 'git',
//   name: 'my-project',
//   gitRemote: 'https://github.com/user/project.git',
//   detectedAt: Date
// }
```

#### getWorkspaceConfig()
Retrieve configuration for a workspace, loading from `.claude-memory-config.json` if available.

```typescript
async getWorkspaceConfig(workspaceId?: string): Promise<WorkspaceConfig>
```

**Parameters:**
- `workspaceId`: Optional workspace identifier (uses current workspace if not provided)

**Returns:**
```typescript
interface WorkspaceConfig {
  storageEnabled: boolean;       // Whether to enable memory storage
  memoryLimit: number;           // Memory limit in MB
  sessionTimeout: number;        // Session timeout in milliseconds
  gitIntegration: boolean;       // Enable Git integration features
  [key: string]: unknown;        // Additional custom configuration
}
```

**Default Configuration:**
```typescript
{
  storageEnabled: true,
  memoryLimit: 512,            // 512 MB
  sessionTimeout: 1800000,     // 30 minutes
  gitIntegration: true
}
```

**Configuration File Location:**
- `<workspace>/.claude-memory-config.json`

**Example:**
```typescript
// Get config for specific workspace
const config = await manager.getWorkspaceConfig('/Users/project');

// Get config for current workspace
const currentConfig = await manager.getWorkspaceConfig();
```

#### updateWorkspaceMetadata()
Update workspace metadata and persist to configuration file.

```typescript
async updateWorkspaceMetadata(
  workspaceId: string, 
  metadata: Record<string, unknown>
): Promise<void>
```

**Parameters:**
- `workspaceId`: Workspace identifier to update
- `metadata`: Metadata object to merge with existing metadata

**Behavior:**
- Updates in-memory cache immediately
- Attempts to persist to `.claude-memory-config.json`
- Logs errors if persistence fails but doesn't throw
- Preserves workspace ID during updates

**Example:**
```typescript
await manager.updateWorkspaceMetadata('/Users/project', {
  lastBuildTime: new Date(),
  customField: 'value',
  settings: {
    autoSave: true
  }
});
```

#### switchWorkspace()
Switch to a different workspace, updating the cache if needed.

```typescript
switchWorkspace(workspaceId: string): void
```

**Parameters:**
- `workspaceId`: Workspace path to switch to

**Throws:**
- `Error`: If workspace doesn't exist

**Example:**
```typescript
manager.switchWorkspace('/Users/another-project');
// Now operating in the context of another-project
```

#### clearCache()
Clear the workspace detection cache.

```typescript
clearCache(): void
```

**Example:**
```typescript
manager.clearCache();
// All cached workspace metadata is cleared
```

#### getWorkspaceVectorCount()
Get the number of vectors stored for a specific workspace.

```typescript
async getWorkspaceVectorCount(workspaceId: string): Promise<number>
```

**Parameters:**
- `workspaceId`: Workspace identifier

**Returns:**
- `number`: Count of vectors in the workspace

**Example:**
```typescript
const count = await manager.getWorkspaceVectorCount('/Users/project');
console.log(`Workspace has ${count} vectors`);
```

**Behavior:**
- Creates workspace record if not exists
- Updates last accessed timestamp
- Detects Git repository information
- Generates deterministic ID from path

#### initializeWorkspace()
Explicitly initialize a workspace with custom configuration.

```typescript
async initializeWorkspace(
  path: string,
  config?: WorkspaceConfig
): Promise<void>
```

**Parameters:**
- `path`: Workspace root path
- `config`: Optional workspace configuration

```typescript
interface WorkspaceConfig {
  name?: string;           // Custom workspace name
  vectorIndexType?: 'basic' | 'scalable';  // Vector index type
  memoryLimit?: number;    // Max memories to store
  retentionDays?: number;  // Auto-cleanup after days
  metadata?: Record<string, any>;  // Custom metadata
}
```

**Validation:**
- Path must exist and be accessible
- Path must be absolute
- Cannot reinitialize active workspace

#### getWorkspaceConfig()
Retrieve current workspace configuration.

```typescript
async getWorkspaceConfig(
  workspaceId: string
): Promise<WorkspaceConfig>
```

**Returns:** Current workspace configuration including defaults

#### updateWorkspaceMetadata()
Update workspace metadata without affecting configuration.

```typescript
async updateWorkspaceMetadata(
  workspaceId: string,
  metadata: Record<string, any>
): Promise<void>
```

**Parameters:**
- `workspaceId`: Target workspace ID
- `metadata`: Metadata to merge (not replace)

**Behavior:**
- Merges with existing metadata
- Validates metadata size (max 10KB)
- Updates last modified timestamp

#### listWorkspaces()
List all known workspaces with optional filtering.

```typescript
async listWorkspaces(
  filters?: WorkspaceFilters
): Promise<Workspace[]>
```

**Filters:**
```typescript
interface WorkspaceFilters {
  active?: boolean;        // Only active workspaces
  stale?: boolean;         // Not accessed in 30+ days  
  hasGit?: boolean;        // Only Git repositories
  namePattern?: string;    // Name glob pattern
}
```

#### cleanupWorkspace()
Remove stale data from a workspace.

```typescript
async cleanupWorkspace(
  workspaceId: string,
  options?: CleanupOptions
): Promise<CleanupStats>
```

**Options:**
```typescript
interface CleanupOptions {
  olderThan?: Date;        // Remove memories before date
  keepRecent?: number;     // Keep N most recent
  removeVectors?: boolean; // Clean vector index
  removeFiles?: boolean;   // Clean file store
}
```

**Returns:**
```typescript
interface CleanupStats {
  memoriesRemoved: number;
  vectorsRemoved: number;
  filesRemoved: number;
  spaceReclaimed: number;  // Bytes
}
```

### WorkspaceManager Implementation Notes

**Storage:**
- Workspace metadata stored in SQLite `workspaces` table
- Separate vector indexes per workspace
- Isolated file storage directories

**Performance:**
- Workspace detection cached for 5 minutes
- Git info refreshed on demand
- Lazy loading of workspace configs

**Security:**
- Path traversal prevention
- Workspace ID validation
- Metadata sanitization

## Session Management API

### SessionManager

The SessionManager tracks Claude Code sessions, maintaining context continuity and session history. It provides session lifecycle management with automatic cleanup and persistence.

#### Constructor

```typescript
constructor(config: Partial<SessionConfig> = {}, db?: SQLiteDatabase | null)
```

**Parameters:**
- `config`: Session configuration options
- `db`: Optional SQLite database for persistence

```typescript
interface SessionConfig {
  sessionTimeout: number;      // Session timeout in milliseconds (default: 30 minutes)
  maxActiveSessions: number;   // Maximum concurrent active sessions (default: 10)
  persistSessions: boolean;    // Whether to persist sessions to database (default: true)
}
```

#### createSession()
Create a new session for a workspace.

```typescript
createSession(
  workspaceId: string,
  metadata: Record<string, unknown> = {}
): Session
```

**Parameters:**
- `workspaceId`: Workspace identifier for the session
- `metadata`: Optional metadata to attach to the session

**Returns:**
```typescript
interface Session {
  id: string;                    // Unique session ID (format: session_timestamp_hash)
  workspaceId: string;           // Associated workspace
  startTime: Date;               // Session start time
  lastActivity: Date;            // Last activity timestamp
  endTime?: Date;                // Session end time (if ended)
  metadata: Record<string, unknown>;  // Session metadata
  isActive: boolean;             // Whether session is currently active
}
```

**Behavior:**
- Auto-generates unique session ID with timestamp
- Enforces maximum active sessions limit
- Cleans up old sessions if at capacity
- Persists to database if configured
- Starts cleanup interval for expired sessions

**Throws:**
- `Error`: If maximum active sessions limit reached after cleanup

**Example:**
```typescript
const session = manager.createSession('/Users/project', {
  purpose: 'debugging',
  userId: 'user123'
});
console.log(session.id); // session_1234567890_abcd1234
```

#### getSession()
Retrieve a session by ID.

```typescript
getSession(sessionId: string): Session | null
```

**Parameters:**
- `sessionId`: Session identifier to retrieve

**Returns:**
- `Session` object if found, `null` otherwise

**Behavior:**
- Checks in-memory cache first
- Falls back to database if configured
- Ends expired sessions automatically
- Updates in-memory cache from database

**Example:**
```typescript
const session = manager.getSession('session_1234567890_abcd1234');
if (session && session.isActive) {
  console.log('Session is active');
}
```

#### getActiveSession()
Get the currently active session for a workspace.

```typescript
getActiveSession(workspaceId?: string): Session | null
```

**Parameters:**
- `workspaceId`: Optional workspace ID (returns any active session if not provided)

**Returns:**
- Most recently active `Session` or `null` if none found

**Example:**
```typescript
// Get active session for specific workspace
const activeSession = manager.getActiveSession('/Users/project');

// Get any active session
const anyActive = manager.getActiveSession();
```

#### endSession()
End a session and mark it as inactive.

```typescript
endSession(sessionId: string): void
```

**Parameters:**
- `sessionId`: Session ID to end

**Behavior:**
- Sets `endTime` to current timestamp
- Marks session as inactive
- Updates database if configured
- Removes from active sessions cache

**Example:**
```typescript
manager.endSession('session_1234567890_abcd1234');
// Session is now ended and inactive
```

#### getSessionHistory()
Retrieve session history for a workspace.

```typescript
getSessionHistory(workspaceId: string, limit: number = 50): Session[]
```

**Parameters:**
- `workspaceId`: Workspace to get history for
- `limit`: Maximum number of sessions to return (default: 50)

**Returns:**
- Array of `Session` objects, sorted by start time (newest first)

**Behavior:**
- Returns from cache if available
- Queries database if configured
- Filters by workspace ID
- Limits results for performance

**Example:**
```typescript
const history = manager.getSessionHistory('/Users/project', 10);
console.log(`Found ${history.length} recent sessions`);
```

#### updateSessionActivity()
Update the last activity timestamp for a session.

```typescript
updateSessionActivity(sessionId: string): void
```

**Parameters:**
- `sessionId`: Session ID to update

**Behavior:**
- Updates `lastActivity` to current time
- Prevents session from expiring
- Updates database if configured

**Example:**
```typescript
// Keep session alive during activity
manager.updateSessionActivity(session.id);
```

#### cleanupInactiveSessions()
Clean up expired sessions based on timeout configuration.

```typescript
cleanupInactiveSessions(): void
```

**Behavior:**
- Runs automatically at intervals
- Ends sessions inactive longer than `sessionTimeout`
- Can be called manually for immediate cleanup
- Logs cleanup actions

**Example:**
```typescript
// Manual cleanup if needed
manager.cleanupInactiveSessions();
```

#### getActiveSessions()
Get all currently active sessions.

```typescript
getActiveSessions(): Session[]
```

**Returns:**
- Array of all active sessions across all workspaces

**Example:**
```typescript
const activeSessions = manager.getActiveSessions();
console.log(`${activeSessions.length} active sessions`);
```

#### getActiveSessionsForWorkspace()
Get active sessions for a specific workspace.

```typescript
getActiveSessionsForWorkspace(workspaceId: string): Session[]
```

**Parameters:**
- `workspaceId`: Workspace identifier

**Returns:**
- Array of active sessions for the workspace

**Example:**
```typescript
const workspaceSessions = manager.getActiveSessionsForWorkspace('/Users/project');
console.log(`${workspaceSessions.length} active sessions in workspace`);
```

#### clearAllSessions()
Clear all sessions (for testing/cleanup).

```typescript
clearAllSessions(): void
```

**Behavior:**
- Ends all active sessions
- Clears in-memory cache
- Updates database if configured

**Example:**
```typescript
// Reset all sessions
manager.clearAllSessions();
```

#### close()
Clean up resources and stop background tasks.

```typescript
close(): void
```

**Behavior:**
- Stops cleanup interval
- Closes database connections
- Should be called on shutdown

**Example:**
```typescript
// On application shutdown
manager.close();
```
- Initializes activity tracking
- Sets session as active

#### getActiveSession()
Get the currently active session for a workspace.

```typescript
async getActiveSession(
  workspaceId: string
): Promise<Session | null>
```

**Returns:**
- Active session if exists
- `null` if no active session

**Notes:**
- Only one active session per workspace
- Sessions expire after inactivity timeout

#### endSession()
Explicitly end a session.

```typescript
async endSession(
  sessionId: string,
  metadata?: Record<string, any>
): Promise<void>
```

**Behavior:**
- Sets session status to 'ended'
- Records end timestamp
- Merges final metadata
- Preserves session history

#### getSessionHistory()
Retrieve session history for a workspace.

```typescript
async getSessionHistory(
  workspaceId: string,
  options?: SessionHistoryOptions
): Promise<Session[]>
```

**Options:**
```typescript
interface SessionHistoryOptions {
  limit?: number;          // Max results (default: 10)
  offset?: number;         // Pagination offset
  startDate?: Date;        // Filter by date range
  endDate?: Date;
  includeExpired?: boolean; // Include expired sessions
  orderBy?: 'startedAt' | 'endedAt' | 'memoryCount';
  orderDirection?: 'asc' | 'desc';
}
```

#### updateSessionActivity()
Update session's last activity timestamp.

```typescript
async updateSessionActivity(
  sessionId: string
): Promise<void>
```

**Behavior:**
- Updates `lastActivityAt` timestamp
- Resets expiration timer
- Called automatically on memory operations

#### getSessionStats()
Get statistics for a session.

```typescript
async getSessionStats(
  sessionId: string
): Promise<SessionStats>
```

**Returns:**
```typescript
interface SessionStats {
  duration: number;        // Session duration in ms
  memoryCount: number;     // Total memories
  memoriesByType: Record<string, number>;
  avgMemorySize: number;   // Average memory size
  peakActivity: Date;      // Most active timestamp
  gitBranches: string[];   // Branches worked on
}
```

#### expireInactiveSessions()
Expire sessions inactive for timeout period.

```typescript
async expireInactiveSessions(
  timeoutMinutes?: number
): Promise<number>
```

**Parameters:**
- `timeoutMinutes`: Inactivity timeout (default: 30)

**Returns:** Number of sessions expired

**Behavior:**
- Runs periodically via cron
- Sets status to 'expired'
- Preserves session data
- Frees active session slot

### SessionManager Implementation Notes

**Storage:**
- Sessions stored in SQLite `sessions` table
- Indexed by workspace and status
- Memory count maintained via triggers

**Performance:**
- Active session cached per workspace
- Session stats computed on-demand
- History queries optimized with indexes

**Lifecycle:**
- Sessions created implicitly or explicitly
- Auto-expiration after inactivity
- Historical sessions preserved
- Configurable retention policy

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