# Claude Code Memory MCP Server Documentation

## Table of Contents

1. [Architecture Overview](architecture.md)
2. [Getting Started](getting-started.md)
3. [Configuration Guide](configuration.md)
4. [Hook System](hooks.md)
5. [Storage System](storage.md)
6. [Git Integration](git-integration.md)
7. [API Reference](api-reference.md)
8. [Development Guide](development.md)
9. [Troubleshooting](troubleshooting.md)

## Quick Links

- [Installation Guide](getting-started.md#installation)
- [Basic Configuration](configuration.md#basic-setup)
- [Hook Examples](hooks.md#examples)
- [Contributing](../CONTRIBUTING.md)

## Overview

The Claude Code Memory MCP Server provides persistent memory capabilities for Claude Code sessions through the Model Context Protocol. This documentation covers all aspects of installation, configuration, and usage.

### Core Concepts

- **Memory Capture**: How events are captured through hooks
- **Storage Engine**: Multi-layer storage system for different data types
- **Intelligent Retrieval**: Semantic search and context injection
- **Git Integration**: Branch-aware memory management
- **Data Integrity**: Corruption prevention and recovery mechanisms

### Architecture Principles

1. **Defensive Programming**: Every operation assumes potential failure
2. **Local-First**: Minimizes external dependencies
3. **Workspace Isolation**: Complete separation between projects
4. **Verified Data**: Only hook-verified events are stored
5. **Progressive Enhancement**: Core features work without advanced capabilities

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/yourusername/claude-memory-mcp/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/claude-memory-mcp/discussions)
- **Security**: See [SECURITY.md](../SECURITY.md) for reporting vulnerabilities