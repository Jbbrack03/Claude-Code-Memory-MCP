# Implementation Phases 9-12

## Phase 9: CLI Integration Layer

### Overview
Create a CLI wrapper that bridges Claude Code hooks with the MCP server, enabling the documented hook-based integration pattern.

### 9.1 CLI Interface Implementation

#### 9.1.1 Main CLI Entry Point
- **File**: `src/cli/index.ts` ✅ CREATED
- **Features**:
  - Parse command line arguments
  - Route to appropriate handlers (inject-context, capture-event, server)
  - Initialize subsystems on demand
  - Handle process lifecycle

#### 9.1.2 Context Injection Handler
- **Command**: `claude-memory inject-context`
- **Functionality**:
  - Detect current workspace
  - Retrieve relevant memories based on context
  - Build formatted context for injection
  - Output MCP-compatible JSON

#### 9.1.3 Event Capture Handler
- **Command**: `claude-memory capture-event`
- **Functionality**:
  - Parse hook event data
  - Detect workspace and session
  - Capture memory with full metadata
  - Validate against Git state

### 9.2 Package Configuration

#### 9.2.1 Update package.json
```json
{
  "bin": {
    "claude-memory": "./dist/cli/index.js",
    "claude-memory-mcp": "./dist/server/index.js"
  },
  "scripts": {
    "build:cli": "tsc --project tsconfig.cli.json",
    "link:local": "npm link"
  }
}
```

#### 9.2.2 Create tsconfig.cli.json
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist/cli"
  },
  "include": ["src/cli/**/*"]
}
```

### 9.3 Tests

#### Test: CLI Command Parsing
```typescript
describe('CLI', () => {
  it('should parse inject-context command', async () => {
    const args = ['inject-context', '--tool=Write', '--session=test123'];
    const result = await parseCommand(args);
    expect(result.command).toBe('inject-context');
    expect(result.options.tool).toBe('Write');
  });

  it('should detect workspace from git', async () => {
    const workspace = await detectWorkspace();
    expect(workspace).toMatch(/\/path\/to\/repo$/);
  });
});
```

## Phase 10: Workspace and Session Management

### Overview
Implement proper workspace detection and session lifecycle management to replace hardcoded defaults.

### 10.1 Workspace Detection

#### 10.1.1 Workspace Manager
- **File**: `src/workspace/manager.ts`
```typescript
export class WorkspaceManager {
  async detectWorkspace(): Promise<string> {
    // Try Git repository root
    const gitRoot = await this.getGitRoot();
    if (gitRoot) return gitRoot;
    
    // Try package.json location
    const packageRoot = await this.findPackageRoot();
    if (packageRoot) return packageRoot;
    
    // Fallback to current directory
    return process.cwd();
  }
  
  async getWorkspaceMetadata(workspaceId: string): Promise<WorkspaceMetadata> {
    return {
      id: workspaceId,
      type: await this.detectWorkspaceType(workspaceId),
      name: path.basename(workspaceId),
      gitRemote: await this.getGitRemote(workspaceId)
    };
  }
}
```

#### 10.1.2 Update GitIntegration
- Add `getCurrentWorkspace()` method
- Cache workspace detection results
- Handle workspace switching

### 10.2 Session Management

#### 10.2.1 Session Manager
- **File**: `src/session/manager.ts`
```typescript
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  
  generateSessionId(): string {
    return `session_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }
  
  async createSession(workspaceId: string): Promise<Session> {
    const session = {
      id: this.generateSessionId(),
      workspaceId,
      startTime: new Date(),
      lastActivity: new Date(),
      metadata: {}
    };
    
    this.sessions.set(session.id, session);
    await this.persistSession(session);
    return session;
  }
  
  async getOrCreateSession(workspaceId: string): Promise<Session> {
    // Try to find active session for workspace
    const active = await this.findActiveSession(workspaceId);
    if (active) {
      active.lastActivity = new Date();
      return active;
    }
    
    return this.createSession(workspaceId);
  }
}
```

#### 10.2.2 Session Persistence
- Store sessions in SQLite
- Track session lifecycle events
- Clean up stale sessions

### 10.3 Integration Updates

#### 10.3.1 Update MCP Server
- Replace hardcoded workspace/session IDs
- Inject WorkspaceManager and SessionManager
- Update all tool handlers

#### 10.3.2 Update Storage Engine
- Add workspace indexing
- Improve query performance for workspace-scoped queries

## Phase 11: Hook System Alignment

### Overview
Align the hook system with Claude Code's actual hook format and behavior, fixing the integration mismatch.

### 11.1 Hook Format Updates

#### 11.1.1 Claude Code Hook Configuration
- **File**: `examples/claude-hooks.json`
```json
{
  "hooks": {
    "PreToolUse": {
      ".*": {
        "command": ["claude-memory", "inject-context"],
        "env": {
          "TOOL_NAME": "${tool}",
          "SESSION_ID": "${sessionId}"
        }
      }
    },
    "PostToolUse": {
      ".*": {
        "command": ["claude-memory", "capture-event"],
        "env": {
          "TOOL_NAME": "${tool}",
          "TOOL_STATUS": "${status}",
          "SESSION_ID": "${sessionId}"
        }
      }
    }
  }
}
```

#### 11.1.2 Hook Response Format
- Implement proper JSON response format
- Support for permission decisions (allow/deny)
- Include context in response

### 11.2 MCP Tool Naming

#### 11.2.1 Tool Registration Updates
- Follow MCP tool naming convention: `mcp__<server>__<tool>`
- Update tool matchers in examples
- Document tool naming patterns

### 11.3 Hook Testing

#### Test: Hook Integration
```typescript
describe('Hook Integration', () => {
  it('should inject context for PreToolUse', async () => {
    const result = await executeHook('PreToolUse', {
      tool: 'mcp__memory__capture',
      sessionId: 'test123'
    });
    
    expect(result.type).toBe('context');
    expect(result.context).toContain('Previous memory');
  });
});
```

## Phase 12: Final Integration and Testing

### Overview
Complete end-to-end integration testing and fix any remaining issues to ensure the system works as designed.

### 12.1 Integration Testing

#### 12.1.1 End-to-End Test Suite
- **File**: `tests/e2e/full-integration.test.ts`
- Test complete workflows:
  - Hook triggers memory capture
  - Context injection on tool use
  - Workspace isolation
  - Session continuity

#### 12.1.2 Claude Code Integration Tests
- Manual testing with Claude Code
- Verify hook execution
- Test context injection
- Validate memory persistence

### 12.2 Documentation Updates

#### 12.2.1 Update README
- Correct hook configuration examples
- Add troubleshooting section
- Include architecture diagram
- Add quick start guide

#### 12.2.2 Create Setup Guide
- **File**: `docs/setup-guide.md`
- Step-by-step installation
- Hook configuration
- Environment setup
- Common issues

### 12.3 Final Fixes

#### 12.3.1 Bug Fixes
- Fix vector store metadata extraction
- Implement storage test helpers
- Add hook configuration validation
- Fix any remaining TypeScript errors

#### 12.3.2 Performance Validation
- Load test with 10k+ memories
- Verify query performance
- Test concurrent operations
- Validate resource usage

### 12.4 Release Preparation

#### 12.4.1 Version Bump
- Update version to 1.0.0
- Update CHANGELOG.md
- Tag release

#### 12.4.2 NPM Publishing
- Build all artifacts
- Test npm package locally
- Publish to npm registry
- Update installation docs

## Implementation Timeline

- **Phase 9**: 2 days - CLI wrapper implementation
- **Phase 10**: 3 days - Workspace and session management
- **Phase 11**: 2 days - Hook system alignment
- **Phase 12**: 2 days - Final integration and testing

**Total**: 9 days to complete the missing functionality

## Success Criteria

1. CLI commands work as documented
2. Workspace detection is automatic and accurate
3. Sessions persist across Claude Code invocations
4. Hooks integrate properly with Claude Code
5. All tests pass with >90% coverage
6. Performance meets requirements (<200ms response time)
7. Documentation is complete and accurate