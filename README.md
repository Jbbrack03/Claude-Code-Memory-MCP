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
npm install claude-memory-mcp
```

## Configuration

Add to your Claude Code configuration:

```json
{
  "claude-memory": {
    "command": "claude-memory-mcp",
    "args": ["--production"],
    "env": {
      "MEMORY_MODE": "production",
      "GIT_INTEGRATION": "true",
      "MAX_MEMORY_SIZE": "100MB"
    }
  }
}
```

### Hook Configuration

Configure Claude Code hooks to capture events:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "claude-memory inject-context --operation=pre-tool"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "claude-memory capture-event --operation=post-tool"
          }
        ]
      }
    ]
  }
}
```

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
│   ├── storage/          # Storage engine and abstractions
│   ├── hooks/            # Hook system and execution
│   ├── git/              # Git integration
│   ├── intelligence/     # Embedding and retrieval
│   └── types/            # TypeScript type definitions
├── tests/                # Test suites
├── docs/                 # Documentation
└── examples/             # Example configurations
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