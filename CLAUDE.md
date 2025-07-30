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
npm test                 # Run all tests (472 tests as of 2025-07-28)
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
npx jest path/to/file.test.ts    # Run specific test file
npx jest -t "test name"          # Run tests matching pattern

# Integration tests
npm test tests/integration/mcp-server.test.ts  # Run MCP integration tests
```

### Code Quality
```bash
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint issues
npm run typecheck        # Type check without building (tsc --noEmit)
```
When implementing new features:
1. Use test-architect to plan the test strategy
2. Use test-writer to create failing tests
3. Use implementation-verifier to write minimal passing code
4. Use refactoring-specialist to improve the code
5. Use test-coverage-analyst to verify coverage
6. Use test-quality-auditor for final review

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
- ✅ Phase 1: Storage Engine Foundation (COMPLETE)
- ✅ Phase 2: Hook System Implementation (COMPLETE)
- ✅ Phase 3: Git Integration (COMPLETE - fully implemented with tests)
- ✅ Phase 4: Intelligence Layer (COMPLETE - fully implemented with tests)
- ✅ Phase 5: MCP Server Integration (COMPLETE)
- ✅ Phase 6: Production Hardening (COMPLETE)
- 🔲 Phase 7: Performance Optimization
- 🔲 Phase 8: Release Preparation

### Current Status (2025-07-28):
- **Completed**: Phases 1, 2, 3, 4, and 6 with full test coverage
- **Phase 6 Production Hardening**: ✅ COMPLETE
  - ✅ Scalable Vector Index: Integrated ScalableVectorIndexImpl with hnswlib-node
  - ✅ Rate Limiting: Implemented RateLimiter with sliding/fixed window modes
  - ✅ Git Remote Tracking: Added getRemoteTrackingInfo() to monitor branch sync
  - ✅ Code Quality Fixes: Fixed error messages, added timer cleanup
  - ✅ Vector Similarity Search: Integrated semantic search in StorageEngine
  - ✅ MCP Server Rate Limiting: Added rate limiting to all tool handlers
  - ✅ Production Tests: Added comprehensive production hardening test suite
- **Test Suite**: 486+ tests passing (100% pass rate)
- **Storage Engine**: Fully implemented with SQLite, Vector Store, File Store, and semantic search
- **Hook System**: Complete with executor, circuit breaker, and security sandboxing
- **Git Integration**: Complete with monitor, validator, integration tests, and remote tracking
- **Vector Store**: Enhanced with scalable index option, cosine similarity, metadata filtering
- **Intelligence Features**: Semantic search, query caching, reranking, context building
- **Rate Limiting**: Production-ready rate limiter with TTL support and cleanup
- **Security Enhancements**: Advanced command injection prevention with comprehensive parsing
- **Documentation**: Hook configuration guide added at `docs/hook-configuration.md`
- **Integration Tests**: Comprehensive integration tests covering all subsystems

### Recent Improvements (2025-07-28):
- Implemented ScalableVectorIndexImpl integration with hnswlib-node for O(log n) search
- Created comprehensive RateLimiter with sliding/fixed window modes and TTL support
- Added Git remote tracking functionality with ahead/behind commit counts
- Fixed code quality issues: improved error messages and added timer cleanup with `.unref()`
- Integrated rate limiting into MCP server tool handlers (capture-memory, retrieve-memories, build-context)
- Completed vector similarity integration in StorageEngine.queryMemories with semantic search
- Added comprehensive production hardening test suite in tests/production/
- Increased test suite from 472 to 486+ tests (all passing)
- Enhanced CircuitBreaker with proper resource cleanup on shutdown
- Updated HookSystem to call CircuitBreaker.close() for clean exits

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
- Advanced command injection prevention with pattern detection:
  - Command chaining (`;`, `&&`, `||`)
  - Pipe operations (`|`)
  - Redirections (`>`, `<`)
  - Command substitution (`` ` ``, `$()`)
  - Newline injection
- Sensitive data detection and redaction
- No storage of credentials or secrets
- Environment variable isolation in hook execution
- Circuit breaker pattern to prevent cascading failures

## Key Files and Resources

### Documentation
- `IMPLEMENTATION.md` - Detailed 8-phase implementation plan with test specifications
- `docs/hook-configuration.md` - Comprehensive guide for configuring hooks
- `STATUS_2025-07-25_08h40_PHASE2_COMPLETE.md` - Latest implementation status

### Core Implementation
- `src/server/index.ts` - MCP server entry point with tool/resource registration
- `src/storage/engine.ts` - Multi-layer storage orchestration
- `src/hooks/system.ts` - Hook execution with circuit breaker
- `src/hooks/executor.ts` - Secure command execution sandbox
- `src/config/index.ts` - Configuration with Zod validation

### Tests
- `tests/storage/` - Storage subsystem tests (SQLite, Vector, File Store)
- `tests/hooks/` - Hook system tests (Executor, Circuit Breaker, System)
- `tests/integration/mcp-server.test.ts` - Full integration tests

### Configuration
- `.env` - Environment variables (create from `.env.example`)
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration for ESM