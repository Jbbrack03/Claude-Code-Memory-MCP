# Development Guide

This guide covers setting up a development environment, contributing to the project, and understanding the codebase architecture.

## Development Setup

### Prerequisites

- **Node.js 18+** with npm
- **Git** for version control
- **TypeScript 5+** knowledge
- **Jest** testing framework familiarity
- **VSCode** or similar editor (recommended)

### Environment Setup

1. **Clone and Install**:
   ```bash
   git clone https://github.com/yourusername/claude-memory-mcp.git
   cd claude-memory-mcp
   npm install
   ```

2. **Development Environment**:
   ```bash
   # Copy example environment
   cp .env.example .env
   
   # Set development mode
   echo "NODE_ENV=development" >> .env
   echo "LOG_LEVEL=debug" >> .env
   ```

3. **Development Tools**:
   ```bash
   # Install development dependencies
   npm install --save-dev
   
   # Setup pre-commit hooks
   npm run prepare
   ```

### Development Workflow

#### Running in Development Mode

```bash
# Start in watch mode (auto-restarts on changes)
npm run dev

# Start with debug logging
DEBUG=claude-memory:* npm run dev

# Build and run
npm run build
npm start
```

#### Testing

```bash
# Run all tests
npm test

# Watch mode for TDD
npm run test:watch

# Run specific test file
npx jest tests/storage/engine.test.ts

# Run tests with coverage
npm run test:coverage

# Run integration tests only
npm test tests/integration/
```

#### Code Quality

```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Type checking
npm run typecheck

# Format code
npm run format
```

## Project Structure

```
claude-memory-mcp/
├── src/                          # Source code
│   ├── server/                   # MCP server implementation
│   │   └── index.ts             # Server entry point
│   ├── storage/                  # Storage subsystem
│   │   ├── engine.ts            # Multi-layer storage orchestration
│   │   ├── sqlite-database.ts   # SQLite implementation
│   │   ├── vector-store.ts      # Vector index and search
│   │   └── file-store.ts        # Large file storage
│   ├── hooks/                    # Hook system
│   │   ├── system.ts            # Hook orchestration
│   │   ├── executor.ts          # Secure command execution
│   │   └── circuit-breaker.ts   # Failure protection
│   ├── git/                      # Git integration
│   │   ├── integration.ts       # Unified Git interface
│   │   ├── monitor.ts           # Repository monitoring
│   │   └── validator.ts         # Memory validation
│   ├── intelligence/             # AI and semantic features
│   │   ├── layer.ts             # Intelligence orchestration
│   │   ├── embedding-generator.ts # Text embeddings
│   │   ├── context-builder.ts   # Context assembly
│   │   └── model-memory-limiter.ts # Memory management
│   ├── monitoring/               # Observability
│   │   ├── metrics-collector.ts # Prometheus metrics
│   │   ├── health-check.ts      # Health monitoring
│   │   ├── alert-manager.ts     # Alerting system
│   │   └── resource-monitor.ts  # System resource monitoring
│   ├── utils/                    # Shared utilities
│   │   ├── logger.ts            # Structured logging
│   │   ├── memory-manager.ts    # Memory utilities
│   │   └── timeout-helpers.ts   # Timeout management
│   └── config/                   # Configuration
│       └── index.ts             # Config loading and validation
├── tests/                        # Test suite
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   ├── performance/             # Performance benchmarks
│   └── utils/                   # Test utilities
├── docs/                         # Documentation
└── dist/                         # Compiled output
```

## Architecture Principles

### Core Principles

1. **Defensive Programming**: Assume everything can fail
2. **Test-Driven Development**: Write tests first
3. **Workspace Isolation**: No cross-project contamination
4. **Verified Data Only**: Only store hook-verified events
5. **Performance First**: Sub-200ms response times

### Design Patterns

- **Multi-layer Storage**: SQLite + Vector + File stores
- **Circuit Breaker**: Failure isolation and recovery
- **Observer Pattern**: Event-driven architecture
- **Factory Pattern**: Component initialization
- **Strategy Pattern**: Pluggable algorithms

## Testing Strategy

### Test Structure

All tests follow the Given/When/Then pattern:

```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { withTimeout } from '../utils/timeout-helpers.js';
import { TestCleanupManager } from '../utils/test-cleanup-manager.js';

describe('ComponentName', () => {
  let component: ComponentName;
  let cleanup: TestCleanupManager;

  beforeEach(async () => {
    cleanup = new TestCleanupManager();
    // Given: Setup test environment
    component = new ComponentName(testConfig);
    await component.initialize();
  });

  afterEach(async () => {
    // Cleanup: Ensure no resource leaks
    await cleanup.cleanup();
  });

  it('should perform expected behavior', async () => {
    await withTimeout(async () => {
      // Given: Test preconditions
      const input = createTestInput();
      
      // When: Execute the operation
      const result = await component.operation(input);
      
      // Then: Verify the outcome
      expect(result).toMatchExpected();
    }, 5000);
  });
});
```

### Test Categories

1. **Unit Tests**: Individual component testing
2. **Integration Tests**: Component interaction testing
3. **Performance Tests**: Benchmark and stress testing
4. **End-to-End Tests**: Full workflow testing

### Test Utilities

The project provides several test utilities:

- **`withTimeout`**: Timeout-aware test execution
- **`TestCleanupManager`**: Automatic resource cleanup
- **Enhanced Mocks**: Timeout-safe mocking

## Contributing Guidelines

### Development Process

1. **Issue Creation**: Create GitHub issue for bugs/features
2. **Branch Creation**: Create feature branch from `main`
3. **TDD Development**: Write failing tests first
4. **Implementation**: Write minimal code to pass tests
5. **Refactoring**: Improve code quality
6. **Documentation**: Update relevant documentation
7. **Pull Request**: Submit PR with thorough description

### TDD Workflow

Follow the Red-Green-Refactor cycle:

```bash
# 1. Red: Write failing test
npm run test:watch

# 2. Green: Write minimal implementation
# Edit source files to make tests pass

# 3. Refactor: Improve code quality
npm run lint:fix
npm run typecheck

# 4. Commit: Save progress
git add .
git commit -m "feat: implement feature X"
```

### Code Standards

- **TypeScript**: Strict mode enabled
- **ESLint**: Follow project rules
- **Prettier**: Consistent formatting
- **JSDoc**: Document public APIs
- **Error Handling**: Comprehensive error boundaries

### Commit Messages

Use conventional commit format:

```
type(scope): description

types: feat, fix, docs, style, refactor, test, chore
scopes: storage, hooks, git, intelligence, monitoring, config
```

Examples:
- `feat(storage): add vector similarity search`
- `fix(hooks): handle timeout errors gracefully`
- `docs(api): update memory capture examples`

## Debugging

### Local Development

```bash
# Debug with Node.js inspector
node --inspect-brk dist/server/index.js

# Debug tests
node --inspect-brk node_modules/.bin/jest --runInBand

# Debug specific component
DEBUG=claude-memory:storage npm run dev
```

### VSCode Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Server",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/dist/server/index.js",
      "env": {
        "NODE_ENV": "development",
        "LOG_LEVEL": "debug"
      },
      "console": "integratedTerminal",
      "restart": true,
      "runtimeArgs": ["--inspect"]
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand", "${fileBasenameNoExtension}"],
      "console": "integratedTerminal",
      "env": {
        "NODE_ENV": "test"
      }
    }
  ]
}
```

## Performance Optimization

### Profiling

```bash
# CPU profiling
NODE_OPTIONS="--prof" npm start
node --prof-process isolate-*.log > profile.txt

# Memory profiling
NODE_OPTIONS="--inspect --heap-prof" npm start

# Benchmark tests
npm run test:performance
```

### Key Performance Areas

1. **Memory Storage**: < 100ms (p95)
2. **Context Injection**: < 200ms (p95)
3. **Hook Execution**: < 500ms (p95)
4. **Semantic Search**: < 200ms (p95)

## Deployment

### Production Build

```bash
# Clean build
npm run clean
npm run build

# Verify build
npm run typecheck
npm test

# Package for distribution
npm pack
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY docs/ ./docs/

EXPOSE 3000
CMD ["node", "dist/server/index.js"]
```

## Resources

### Documentation
- [Getting Started](getting-started.md)
- [Configuration Guide](configuration.md)
- [API Reference](api-reference.md)
- [Architecture Overview](architecture.md)

### External Resources
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Jest Testing Framework](https://jestjs.io/docs/getting-started)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)