# Hook Configuration Guide

## Overview

The Claude Code Memory MCP Server uses hooks to capture events from Claude Code. Hooks are executed in a secure, sandboxed environment with configurable resource limits.

## Configuration

Hooks can be configured through environment variables or the configuration file.

### Environment Variables

```bash
# Hook execution limits
HOOK_TIMEOUT=5000              # Timeout in milliseconds (default: 5000)
HOOK_MAX_MEMORY=100MB          # Maximum memory usage (default: 100MB)
HOOK_MAX_CPU=1                 # Maximum CPU cores (default: 1)

# Circuit breaker settings
CIRCUIT_FAILURE_THRESHOLD=5    # Failures before opening circuit (default: 5)
CIRCUIT_RESET_TIMEOUT=60000    # Reset timeout in ms (default: 60000)
CIRCUIT_HALF_OPEN_REQUESTS=3   # Requests in half-open state (default: 3)

# Sandbox settings
SANDBOX_ENABLED=true           # Enable command sandboxing (default: true)
SANDBOX_ALLOWED_COMMANDS=echo,date,claude-memory  # Comma-separated list
```

### Configuration File

```json
{
  "hooks": {
    "execution": {
      "timeout": 5000,
      "maxMemory": "100MB",
      "maxCpu": 1
    },
    "circuitBreaker": {
      "failureThreshold": 5,
      "resetTimeout": 60000,
      "halfOpenRequests": 3
    },
    "sandbox": {
      "enabled": true,
      "allowedCommands": ["echo", "date", "claude-memory"],
      "env": {
        "CUSTOM_VAR": "value"
      }
    }
  }
}
```

## Security Features

### Command Sandboxing

Hooks are executed in a sandboxed environment with the following security features:

1. **Command Allowlist**: Only explicitly allowed commands can be executed
2. **No Shell Execution**: Commands are spawned directly without shell interpretation
3. **Environment Isolation**: Only specified environment variables are available
4. **Command Injection Prevention**: Advanced parsing prevents injection attacks including:
   - Command chaining (`;`, `&&`, `||`)
   - Pipe operations (`|`)
   - Redirections (`>`, `<`)
   - Command substitution (`` ` ``, `$()`)
   - Newline injection

### Resource Limits

- **Timeout**: Hooks are terminated if they exceed the configured timeout
- **Memory**: Memory usage is limited (requires system support)
- **CPU**: CPU usage can be limited to prevent resource exhaustion

### Circuit Breaker

The circuit breaker pattern prevents cascading failures:

1. **Closed State**: Normal operation, requests pass through
2. **Open State**: After threshold failures, requests are immediately rejected
3. **Half-Open State**: After reset timeout, limited requests test recovery

## Hook Examples

### Basic Memory Capture Hook

```bash
#!/bin/bash
# Save as: hooks/capture-file-write.sh
# Add to SANDBOX_ALLOWED_COMMANDS: bash

event_type="$1"
file_path="$2"
content="$3"

if [ "$event_type" = "file_write" ]; then
  echo "{\"capture\": true, \"metadata\": {\"file\": \"$file_path\"}}"
fi
```

### Node.js Hook Example

```javascript
#!/usr/bin/env node
// Save as: hooks/process-event.js
// Add to SANDBOX_ALLOWED_COMMANDS: node

const eventType = process.argv[2];
const data = JSON.parse(process.argv[3] || '{}');

if (eventType === 'test_complete') {
  console.log(JSON.stringify({
    capture: true,
    content: `Tests completed: ${data.passed}/${data.total}`,
    metadata: { 
      passed: data.passed,
      failed: data.failed,
      duration: data.duration
    }
  }));
}
```

## Hook Registration

Hooks are registered with the HookSystem during initialization:

```typescript
// This happens automatically based on configuration
hookSystem.register({
  name: 'file-write-hook',
  pattern: /^file_write$/,
  command: 'hooks/capture-file-write.sh'
});
```

## Best Practices

1. **Keep Hooks Simple**: Hooks should execute quickly and reliably
2. **Handle Errors**: Always handle potential errors gracefully
3. **Return JSON**: Hooks should return valid JSON for structured data
4. **Avoid Side Effects**: Hooks should be read-only where possible
5. **Test Thoroughly**: Test hooks with various inputs and edge cases

## Troubleshooting

### Hook Not Executing

1. Check if the command is in `SANDBOX_ALLOWED_COMMANDS`
2. Verify the hook file has execute permissions
3. Check circuit breaker state (may be open due to failures)
4. Review logs for specific error messages

### Hook Timing Out

1. Increase `HOOK_TIMEOUT` if the operation legitimately takes longer
2. Optimize hook code to execute faster
3. Consider async processing for long operations

### Security Errors

1. "Command not allowed" - Add command to allowlist
2. "Command injection detected" - Review command for dangerous patterns
3. Ensure quotes are properly handled in arguments

## Environment Variables Available to Hooks

Hooks have access to:
- `PATH`: System PATH (filtered for security)
- `HOME`: User home directory
- `USER`: Current user
- Custom variables defined in `sandbox.env`
- Context variables passed by the hook system

## Performance Considerations

- Hooks are executed synchronously, so they impact response time
- Use circuit breaker thresholds to prevent repeated failures
- Monitor hook execution times and optimize as needed
- Consider caching for expensive operations