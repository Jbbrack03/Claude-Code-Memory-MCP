# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm install              # Install dependencies
npm run dev              # Run server in watch mode (tsx watch src/server/index.ts)
npm run build            # Compile TypeScript to dist/
npm start                # Run compiled server (node dist/server/index.js)
```

### Testing
```bash
npm test                 # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
npx jest path/to/file.test.ts    # Run specific test file
npx jest -t "test name"          # Run tests matching pattern
```

### Code Quality
```bash
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint issues
npm run typecheck        # Type check without building (tsc --noEmit)
```

## Architecture Overview

This is a Model Context Protocol (MCP) server that provides persistent memory for Claude Code sessions. The system captures verified events through hooks, stores them with semantic indexing, and injects relevant context when needed.

### Core Architecture Principles
- **Defensive Programming**: Every operation assumes potential failure. All subsystems have initialization checks, error boundaries, and graceful degradation.
- **Workspace Isolation**: Complete separation between projects - no shared state or cross-contamination.
- **Transactional Integrity**: SQLite with WAL mode ensures ACID compliance. All multi-step operations use transactions.
- **Verified Data Only**: Memory comes only from hook-verified events, preventing hallucination corruption.

### System Components

The server consists of five main subsystems initialized in `src/server/index.ts`:

1. **Storage Engine** (`src/storage/engine.ts`)
   - Multi-layer storage: SQLite for structured data, vector DB for embeddings, file system for large content
   - Handles memory capture, retrieval, and statistics
   - Enforces size limits and workspace isolation

2. **Hook System** (`src/hooks/system.ts`)
   - Executes Claude Code hooks in sandboxed environment
   - Circuit breaker pattern prevents cascading failures
   - Resource limits: timeout, memory, CPU

3. **Git Integration** (`src/git/integration.ts`)
   - Tracks repository state and branch changes
   - Validates memories against Git truth
   - Branch-specific memory isolation

4. **Intelligence Layer** (`src/intelligence/layer.ts`)
   - Generates embeddings using local models (@xenova/transformers)
   - Semantic search and context building
   - Caching and batch processing

5. **MCP Server Core** (`src/server/index.ts`)
   - Implements MCP protocol with tools and resources
   - StdioServerTransport for Claude Code communication
   - Graceful shutdown handling

### Data Flow
1. Claude Code triggers hook → Hook System captures event
2. Storage Engine validates and stores memory with embeddings
3. On tool use, Intelligence Layer retrieves relevant memories
4. Context injection happens through MCP protocol

### Key Implementation Details
- All imports use `.js` extensions for ESM compatibility
- Zod schemas validate all external inputs
- Winston logger with module-specific child loggers
- Config loaded from environment with defaults (`src/config/index.ts`)

## Implementation Status

The project follows TDD with an 8-phase implementation plan (see IMPLEMENTATION.md):
- Phase 1: Storage Engine Foundation
- Phase 2: Hook System Implementation  
- Phase 3: Git Integration
- Phase 4: Intelligence Layer
- Phase 5: MCP Server Integration
- Phase 6: Production Hardening
- Phase 7: Performance Optimization
- Phase 8: Release Preparation

Currently, the project has:
- Complete project structure and configuration
- MCP server skeleton with registered tools/resources
- Stub implementations for all subsystems
- Comprehensive test specifications in IMPLEMENTATION.md

## Testing Approach

Tests follow TDD pattern with Given/When/Then structure:
- Unit tests for each subsystem in `tests/`
- Integration tests for subsystem interactions
- E2E tests for complete workflows
- 80% coverage threshold enforced

Jest configured for ESM with ts-jest. Tests use `.test.ts` extension.

## Performance Requirements
- Hook execution: < 500ms (p95)
- Memory storage: < 100ms (p95)  
- Query response: < 200ms (p95)
- Context injection: < 200ms (p95)

## Security Considerations
- Hooks run in sandboxed environment with resource limits
- Sensitive data detection and redaction
- No storage of credentials or secrets
- Command injection prevention in hook executor