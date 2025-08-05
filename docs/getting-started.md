# Getting Started

This guide will help you install and configure the Claude Code Memory MCP Server to provide persistent memory capabilities for your Claude Code sessions.

## Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** installed on your system
- **Git** (for version control integration)
- **Claude Code** installed and configured
- At least **2GB of available disk space** for model files and storage

## Installation

### Option 1: Install from npm (Recommended)

```bash
npm install -g claude-memory-mcp
```

### Option 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/yourusername/claude-memory-mcp.git
cd claude-memory-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Optionally install globally
npm link
```

## Quick Setup

### 1. Initialize Configuration

Create a configuration directory in your project:

```bash
mkdir -p .claude-memory
```

### 2. Create Environment Configuration

Create a `.env` file in your project root:

```bash
# Basic configuration
NODE_ENV=production
LOG_LEVEL=info

# Storage paths (relative to project root)
SQLITE_PATH=.claude-memory/memory.db
VECTOR_PATH=.claude-memory/vectors
FILE_STORAGE_PATH=.claude-memory/files

# Enable core features
GIT_ENABLED=true
EMBEDDINGS_ENABLED=true
MONITORING_ENABLED=true
```

### 3. Add to Claude Code Configuration

Add the MCP server to your Claude Code `settings.json`:

```json
{
  "mcpServers": {
    "claude-memory": {
      "command": "claude-memory-server",
      "args": [],
      "env": {
        "NODE_ENV": "production",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

Or if installed from source:

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

### 4. Configure Hooks (Essential)

Add hook configuration to your Claude Code `settings.json` to enable memory capture and context injection:

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

## Verification

### Test the Installation

1. **Check MCP Connection**:
   Start Claude Code and verify the memory server appears in the MCP servers list.

2. **Test Basic Commands**:
   ```bash
   # Check server health
   claude-memory health
   
   # View server statistics
   claude-memory stats
   
   # Test context injection
   claude-memory inject-context --query="test"
   ```

3. **Test Memory Capture**:
   Create a simple file with Claude Code. The hooks should automatically capture the event.

### Expected Behavior

When properly configured, you should see:

- **Context Injection**: Relevant project history appears in Claude Code responses
- **Memory Capture**: File changes and important decisions are automatically stored
- **Git Integration**: Memory syncs with your Git branches and repository state
- **Performance**: Context injection completes within 200ms (p95)

## Next Steps

- [Advanced Configuration](configuration.md) - Customize storage, monitoring, and performance settings
- [Hook System](hooks.md) - Configure custom event capture and context injection
- [Troubleshooting](troubleshooting.md) - Resolve common issues

## Quick Troubleshooting

### Common Issues

**Server won't start**:
- Check Node.js version (`node --version` should be 18+)
- Verify file permissions in the `.claude-memory` directory
- Check logs: `tail -f .claude-memory/logs/server.log`

**No context injection**:
- Verify hooks are configured in Claude Code settings
- Check that the `claude-memory` command is in your PATH
- Test manual injection: `claude-memory inject-context --query="test"`

**Memory not captured**:
- Ensure hooks are triggered (check Claude Code hook logs)
- Verify write permissions to storage directories
- Check server health: `claude-memory health`

For detailed troubleshooting, see the [Troubleshooting Guide](troubleshooting.md).