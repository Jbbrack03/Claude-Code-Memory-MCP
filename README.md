# Claude Code Memory MCP Server

A defensive, Git-aware Model Context Protocol (MCP) server that provides persistent memory capabilities for Claude Code sessions. This server addresses the critical limitation where Claude Code loses context between sessions, maintaining project history, decisions, and patterns intelligently.

## Overview

The Claude Code Memory MCP Server captures verified events through Claude Code hooks, stores them with intelligent semantic indexing, and injects relevant context exactly when needed. It's built with defensive programming principles, ensuring data integrity and preventing hallucination corruption.

### Key Features

- **Context Preservation**: Maintains project history, decisions, and patterns across Claude Code sessions
- **Hallucination Prevention**: Captures only verified events through hooks, preventing false memory corruption
- **Intelligent Retrieval**: Provides relevant context exactly when needed during development
- **Git-Aware**: Synchronizes with Git branches and validates against repository truth
- **Production-Ready**: Built with defensive programming, comprehensive monitoring, and self-healing capabilities

## Architecture

The server is built with the following principles:

- **Defensive Programming**: Assume everything can fail
- **Local-First**: Minimize external dependencies
- **Workspace Isolation**: Complete separation between projects
- **Verified Data Only**: Hooks ensure only real events are stored
- **Progressive Enhancement**: Core features work without advanced capabilities

## Installation

```bash
# Clone and build from source
git clone https://github.com/yourusername/claude-memory-mcp.git
cd claude-memory-mcp
npm install
npm run build

# Or install globally (once published)
npm install -g claude-memory-mcp
```

## Configuration

### 1. Environment Setup

Create a `.env` file (see `.env.example` for all options):

```bash
# Core configuration
NODE_ENV=production
LOG_LEVEL=info

# Storage paths
SQLITE_PATH=.claude-memory/memory.db
VECTOR_PATH=.claude-memory/vectors
FILE_STORAGE_PATH=.claude-memory/files

# Features
GIT_ENABLED=true
EMBEDDINGS_ENABLED=true
MONITORING_ENABLED=true
```

### 2. Claude Code MCP Configuration

Add to your Claude Code `settings.json`:

```json
{
  "mcpServers": {
    "claude-memory": {
      "command": "node",
      "args": ["/path/to/claude-memory-mcp/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### 3. Hook Configuration

Configure Claude Code hooks to capture events and inject context:

```json
{
  "hooks": {
    "preToolUse": [
      {
        "description": "Inject context before file operations",
        "tools": ["Write", "Edit", "MultiEdit", "Read"],
        "command": "claude-memory inject-context --query=\"${tool.name} ${tool.input.file_path}\" --limit=5",
        "timeout": 5000
      }
    ],
    "postToolUse": [
      {
        "description": "Capture file modifications",
        "tools": ["Write", "Edit", "MultiEdit"],
        "command": "claude-memory capture-event --type=file_write --content=\"Modified ${tool.input.file_path}\" --metadata='{\"file\":\"${tool.input.file_path}\"}'",
        "timeout": 3000
      }
    ],
    "userPromptSubmit": [
      {
        "description": "Inject context based on user prompt",
        "command": "claude-memory inject-context --query=\"${prompt.text}\" --limit=10",
        "timeout": 5000
      }
    ]
  }
}
```

## Usage

### CLI Commands

The server provides a CLI interface for hook integration:

```bash
# Capture an event
claude-memory capture-event \
  --type=file_write \
  --content="Updated authentication logic" \
  --metadata='{"file":"auth.ts","lines":50}'

# Inject context
claude-memory inject-context \
  --query="working with authentication" \
  --limit=5

# View statistics
claude-memory stats
```

### MCP Tools

When connected as an MCP server, the following tools are available:

- **capture-memory**: Store a memory with semantic indexing
- **retrieve-memories**: Search memories by query and filters
- **build-context**: Build formatted context for injection
- **git-state**: Get current Git repository state
- **health-check**: Check system health and component status

## Development

### Prerequisites

- Node.js v18.x or higher
- TypeScript 5.x
- Git 2.0+

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/claude-memory-mcp.git
cd claude-memory-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

### Project Structure

```
claude-memory-mcp/
├── src/
│   ├── server/           # MCP server implementation
│   ├── cli/              # CLI wrapper for hooks integration
│   ├── storage/          # Multi-layer storage (SQLite, Vector, Files)
│   ├── hooks/            # Hook system with sandboxing
│   ├── git/              # Git integration and validation
│   ├── intelligence/     # Semantic search and embeddings
│   ├── workspace/        # Workspace detection and management
│   ├── session/          # Session lifecycle management
│   ├── monitoring/       # Observability (metrics, tracing, health)
│   ├── utils/            # Shared utilities and helpers
│   └── types/            # TypeScript type definitions
├── tests/                # Comprehensive test suites
├── docs/                 # Documentation
├── examples/             # Example configurations and scripts
└── dist/                 # Compiled JavaScript output
```

### Example: Capturing Code Changes

```typescript
// When you modify a file, the hook captures it automatically
// Before: Claude Code executes Write tool
// Hook: claude-memory inject-context --query="auth.ts authentication"
// During: You get relevant context about previous auth implementations
// After: claude-memory capture-event --type=file_write --content="[changes]"
```

### Example: Semantic Search

```bash
# Search for memories about authentication
claude-memory search --query="authentication logic" --limit=5

# Filter by workspace and time
claude-memory search \
  --query="database schema" \
  --workspace="/path/to/project" \
  --after="2024-01-01" \
  --limit=10
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Security

This server executes hooks in a sandboxed environment with strict resource limits. See our [Security Policy](SECURITY.md) for details on reporting vulnerabilities.

## Support

- **Documentation**: [Full Documentation](docs/README.md)
- **Issues**: [GitHub Issues](https://github.com/yourusername/claude-memory-mcp/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/claude-memory-mcp/discussions)