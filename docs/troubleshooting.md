# Troubleshooting Guide

This guide helps you diagnose and resolve common issues with the Claude Code Memory MCP Server.

## Quick Diagnostics

### Health Check

Start troubleshooting by checking system health:

```bash
# Basic health check
claude-memory health

# Detailed health check
claude-memory health --verbose

# Component-specific checks
claude-memory health --component=storage
claude-memory health --component=git
claude-memory health --component=embeddings
```

### System Information

Get detailed system information:

```bash
# Server statistics
claude-memory stats

# Configuration dump
claude-memory config show

# Log recent activity
claude-memory logs --tail=50
```

## Common Issues

### 1. Server Won't Start

**Symptoms**: 
- MCP server fails to start
- Connection timeouts in Claude Code
- "Server not found" errors

**Diagnostics**:
```bash
# Check if the command exists
which claude-memory-server

# Test direct execution
claude-memory-server --version

# Check logs for startup errors
tail -f ~/.claude/logs/mcp-server.log
```

**Solutions**:

- **Install/Path Issues**:
  ```bash
  # Reinstall globally
  npm install -g claude-memory-mcp
  
  # Or add to PATH if installed locally
  export PATH="$PATH:./node_modules/.bin"
  ```

- **Permission Issues**:
  ```bash
  # Fix storage directory permissions
  mkdir -p .claude-memory
  chmod 755 .claude-memory
  ```

- **Configuration Issues**:
  ```bash
  # Validate configuration
  claude-memory config validate
  
  # Reset to defaults
  claude-memory config reset
  ```

### 2. No Context Injection

**Symptoms**:
- Claude Code responses don't include project history
- No relevant context appears in responses
- Hook execution appears successful but no context injected

**Diagnostics**:
```bash
# Test manual context injection
claude-memory inject-context --query="test query" --verbose

# Check hook execution
grep "inject-context" ~/.claude/logs/hooks.log

# Verify memory storage
claude-memory stats --memories
```

**Solutions**:

- **Hook Configuration**:
  ```json
  // Ensure proper hook setup in settings.json
  {
    "hooks": {
      "preToolUse": [
        {
          "description": "Inject context before file operations",
          "tools": ["Write", "Edit", "MultiEdit", "Read"],
          "command": "claude-memory inject-context --query=\"${tool.name} ${tool.input.file_path}\" --limit=5",
          "timeout": 5000
        }
      ]
    }
  }
  ```

- **Memory Storage Issues**:
  ```bash
  # Check if memories are being stored
  claude-memory list-memories --limit=10
  
  # Manually capture a test memory
  claude-memory capture-event --type=test --content="Test memory"
  ```

- **Performance Issues**:
  ```bash
  # Increase timeout in hook configuration
  "timeout": 10000
  
  # Check system resources
  claude-memory health --component=performance
  ```

### 3. Memory Not Being Captured

**Symptoms**:
- File changes not stored in memory
- Important decisions not captured
- Memory count remains zero

**Diagnostics**:
```bash
# Check hook execution logs
grep "capture-event" ~/.claude/logs/hooks.log

# Test manual capture
claude-memory capture-event --type=file_write --content="Test capture" --verbose

# Check storage permissions
ls -la .claude-memory/
```

**Solutions**:

- **Hook Setup**:
  ```json
  // Add capture hooks to settings.json
  {
    "hooks": {
      "postToolUse": [
        {
          "description": "Capture file modifications",
          "tools": ["Write", "Edit", "MultiEdit"],
          "command": "claude-memory capture-event --type=file_write --content=\"Modified ${tool.input.file_path}\" --metadata='{\"file\":\"${tool.input.file_path}\"}'",
          "timeout": 3000
        }
      ]
    }
  }
  ```

- **Storage Issues**:
  ```bash
  # Check disk space
  df -h .claude-memory/
  
  # Fix permissions
  chmod -R 755 .claude-memory/
  
  # Clear corrupted storage and restart
  rm -rf .claude-memory/
  mkdir .claude-memory
  ```

### 4. Git Integration Problems

**Symptoms**:
- Git state not detected
- Branch switching doesn't isolate memories
- Git validation errors

**Diagnostics**:
```bash
# Check Git integration
claude-memory git-state

# Test Git detection
cd your-project && git status
claude-memory health --component=git
```

**Solutions**:

- **Not a Git Repository**:
  ```bash
  # Initialize Git if needed
  git init
  git add .
  git commit -m "Initial commit"
  ```

- **Git Configuration**:
  ```bash
  # Enable Git integration
  echo "GIT_ENABLED=true" >> .env
  
  # Fix Git permissions
  chmod -R 755 .git/
  ```

- **Branch Isolation Issues**:
  ```bash
  # Enable branch isolation
  echo "GIT_BRANCH_ISOLATION=true" >> .env
  
  # Clear cross-branch memories
  claude-memory clear-memories --branch-only
  ```

### 5. Performance Issues

**Symptoms**:
- Slow context injection (> 200ms)
- High memory usage
- Timeout errors in hooks

**Diagnostics**:
```bash
# Check performance metrics
claude-memory stats --performance

# Memory usage
claude-memory health --component=memory

# Database performance
claude-memory stats --database
```

**Solutions**:

- **Memory Optimization**:
  ```bash
  # Reduce memory limits
  echo "MAX_MEMORY_SIZE_MB=500" >> .env
  
  # Enable memory monitoring
  echo "MEMORY_MONITORING_ENABLED=true" >> .env
  
  # Clear old memories
  claude-memory cleanup --older-than=30d
  ```

- **Vector Index Optimization**:
  ```bash
  # Optimize vector search
  echo "VECTOR_EF_SEARCH=50" >> .env
  echo "VECTOR_MAX_CONNECTIONS=16" >> .env
  
  # Rebuild vector index
  claude-memory rebuild-index
  ```

- **Database Optimization**:
  ```bash
  # Enable WAL mode
  echo "SQLITE_WAL_MODE=true" >> .env
  
  # Increase cache size
  echo "SQLITE_CACHE_SIZE=10000" >> .env
  
  # Vacuum database
  claude-memory vacuum
  ```

### 6. Embedding Model Issues

**Symptoms**:
- Semantic search not working
- Model download failures
- Out of memory errors during embedding

**Diagnostics**:
```bash
# Check embedding status
claude-memory health --component=embeddings

# Test embedding generation
claude-memory test-embeddings --text="test query"

# Check model files
ls -la ~/.cache/huggingface/
```

**Solutions**:

- **Model Download**:
  ```bash
  # Clear model cache and re-download
  rm -rf ~/.cache/huggingface/
  claude-memory download-models
  ```

- **Memory Issues**:
  ```bash
  # Use smaller model
  echo "EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2" >> .env
  
  # Disable embeddings temporarily
  echo "EMBEDDINGS_ENABLED=false" >> .env
  ```

- **Network Issues**:
  ```bash
  # Configure proxy if needed
  export HTTP_PROXY=http://proxy.company.com:8080
  export HTTPS_PROXY=http://proxy.company.com:8080
  ```

### 7. AI Model Memory Management

**Symptoms**:
- Out of memory errors during embedding generation
- System becomes unresponsive when loading models
- Model loading timeouts
- Frequent model reloading

**Diagnostics**:
```bash
# Check model memory usage
claude-memory health --component=model-memory

# Monitor real-time memory usage
claude-memory monitor --memory --interval=1000

# Check model memory limits
grep MODEL_MEMORY ~/.env
```

**Solutions**:

- **Out of Memory Errors**:
  ```bash
  # Reduce model memory limit
  echo "MODEL_MEMORY_LIMIT_MB=256" >> .env
  
  # Enable aggressive cleanup
  echo "MODEL_EMERGENCY_CLEANUP=true" >> .env
  
  # Use fallback models automatically
  echo "MODEL_FALLBACK_ENABLED=true" >> .env
  ```

- **Model Loading Issues**:
  ```bash
  # Increase model loading timeout
  echo "MODEL_LOAD_TIMEOUT=60000" >> .env
  
  # Pre-load models on startup
  echo "MODEL_PRELOAD=true" >> .env
  
  # Use specific smaller models
  echo "MODEL_FALLBACK_LIST=Xenova/all-MiniLM-L6-v2,Xenova/all-MiniLM-L12-v2" >> .env
  ```

- **Memory Monitoring**:
  ```bash
  # Enable detailed memory monitoring
  echo "MODEL_MEMORY_MONITORING_ENABLED=true" >> .env
  echo "MODEL_MEMORY_CHECK_INTERVAL=500" >> .env
  
  # View memory statistics
  claude-memory stats --model-memory --verbose
  ```

- **System-wide Memory Pressure**:
  ```bash
  # Configure system memory awareness
  echo "SYSTEM_MEMORY_THRESHOLD=0.8" >> .env
  
  # Limit total application memory
  echo "MAX_MEMORY_SIZE_MB=1000" >> .env
  
  # Enable memory pressure responses
  echo "MEMORY_PRESSURE_ENABLED=true" >> .env
  ```

## Advanced Diagnostics

### Debug Mode

Enable debug logging for detailed troubleshooting:

```bash
# Set debug level
echo "LOG_LEVEL=debug" >> .env

# Start with debug output
DEBUG=claude-memory:* claude-memory-server

# View debug logs
tail -f .claude-memory/logs/debug.log
```

### Performance Profiling

Profile performance for optimization:

```bash
# CPU profiling
NODE_OPTIONS="--prof" claude-memory-server

# Memory profiling
NODE_OPTIONS="--heap-prof" claude-memory-server

# Analyze profiles
node --prof-process isolate-*.log > profile.txt
```

### Database Diagnostics

Check database health and integrity:

```bash
# Database integrity check
sqlite3 .claude-memory/memory.db "PRAGMA integrity_check;"

# Analyze database statistics
sqlite3 .claude-memory/memory.db "PRAGMA stats;"

# Check table sizes
claude-memory stats --database --verbose
```

## Recovery Procedures

### Corrupted Storage Recovery

If storage becomes corrupted:

```bash
# 1. Stop the server
pkill -f claude-memory-server

# 2. Backup existing data
cp -r .claude-memory .claude-memory.backup

# 3. Try database repair
sqlite3 .claude-memory/memory.db ".recover" | sqlite3 .claude-memory/memory_recovered.db

# 4. If repair fails, start fresh
rm -rf .claude-memory
claude-memory init

# 5. Restore from backup if available
claude-memory restore --from=backup.sql
```

### Configuration Reset

Reset configuration to defaults:

```bash
# Remove custom configuration
rm .env

# Reset MCP configuration
claude-memory config reset

# Restart with defaults
claude-memory-server
```

### Complete Reinstall

If all else fails, completely reinstall:

```bash
# 1. Stop server and remove global installation
pkill -f claude-memory-server
npm uninstall -g claude-memory-mcp

# 2. Remove all data
rm -rf .claude-memory
rm .env

# 3. Clear npm cache
npm cache clean --force

# 4. Reinstall
npm install -g claude-memory-mcp

# 5. Reconfigure
claude-memory init
```

## Getting Help

### Logs and Information

When seeking help, include:

```bash
# System information
claude-memory --version
node --version
npm --version
git --version

# Health check
claude-memory health --verbose

# Recent logs
claude-memory logs --tail=100

# Configuration (scrub sensitive data)
claude-memory config show --safe
```

### Support Channels

- **GitHub Issues**: Report bugs and feature requests
- **Documentation**: Check [Getting Started](getting-started.md) and [Configuration](configuration.md)
- **Community**: Join discussions in project forums

### Filing Bug Reports

Include the following information:

1. **Environment**: OS, Node.js version, Claude Code version
2. **Configuration**: Scrubbed configuration dump
3. **Steps to Reproduce**: Detailed steps that trigger the issue
4. **Expected Behavior**: What should happen
5. **Actual Behavior**: What actually happens
6. **Logs**: Relevant log entries with timestamps
7. **Health Check**: Output of `claude-memory health --verbose`

This information helps maintainers quickly diagnose and resolve issues.