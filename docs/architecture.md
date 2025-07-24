# Architecture Overview

## System Architecture

The Claude Code Memory MCP Server is designed as a modular, defensive system with clear separation of concerns.

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code Client                       │
├─────────────────────────────────────────────────────────────┤
│                        MCP Protocol                         │
├─────────────────────────────────────────────────────────────┤
│                    MCP Server Core                          │
├─────────┬───────────┬────────────┬────────────┬────────────┤
│  Hook   │  Storage  │    Git     │Intelligence│  Monitor   │
│ System  │  Engine   │Integration │   Layer    │  System    │
├─────────┴───────────┴────────────┴────────────┴────────────┤
│              Transaction Manager & Validation               │
├─────────────────────────────────────────────────────────────┤
│         SQLite      │    Vector DB    │   File System      │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. MCP Server Core
- Implements the Model Context Protocol
- Manages client connections and communication
- Routes requests to appropriate subsystems
- Handles protocol-level error recovery

### 2. Hook System
- Captures events from Claude Code hooks
- Validates and sanitizes hook outputs
- Executes hooks in sandboxed environment
- Implements circuit breakers for failing hooks

### 3. Storage Engine
- Multi-layer storage abstraction
- Transaction management with ACID guarantees
- Automatic storage tier selection
- Data compression and optimization

### 4. Git Integration
- Monitors Git state changes
- Validates memories against repository truth
- Branch-specific memory isolation
- Automatic reconciliation on conflicts

### 5. Intelligence Layer
- Local embedding generation
- Semantic search capabilities
- Context relevance scoring
- Pattern recognition and learning

### 6. Monitor System
- Health checks and diagnostics
- Performance monitoring
- Resource usage tracking
- Self-healing mechanisms

## Data Flow

### Memory Capture Flow
```
Claude Code Action
        ↓
    Hook Trigger
        ↓
  Hook Execution
        ↓
  Validation Layer
        ↓
  Storage Engine
        ↓
  Index Update
```

### Context Injection Flow
```
Tool Invocation
        ↓
  Context Request
        ↓
  Semantic Search
        ↓
  Relevance Scoring
        ↓
  Context Building
        ↓
  MCP Response
```

## Security Architecture

### Sandboxing
- All hook executions run in isolated environments
- Resource limits (CPU, memory, I/O)
- No network access from hooks
- Automatic timeout enforcement

### Data Protection
- Sensitive data detection and redaction
- Encryption at rest for stored memories
- Secure memory wiping after use
- Audit trail for all operations

## Performance Considerations

### Caching Strategy
- Hot data in memory cache
- Frequent queries cached with TTL
- Lazy loading for large datasets
- Cache invalidation on updates

### Optimization Techniques
- Index-based queries for fast retrieval
- Batch processing for bulk operations
- Asynchronous background tasks
- Connection pooling for database access

## Scalability Design

### Horizontal Scaling
- Workspace isolation enables parallel operation
- No shared state between projects
- Independent storage per workspace
- Concurrent request handling

### Vertical Scaling
- Configurable memory limits
- Automatic data archival
- Intelligent forgetting of old data
- Progressive loading strategies