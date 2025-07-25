# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2025-07-25

### Added
- Phase 3: Git Integration (COMPLETE)
  - GitMonitor for real-time repository state tracking
  - GitValidator for memory validation against Git state
  - GitIntegration orchestrating monitor and validator subsystems
  - Branch change detection with EventEmitter
  - File change monitoring and dirty state detection
  - Commit and branch validation
  - Comprehensive test suite (35 tests passing)
- Hook configuration documentation guide
- Integration tests for complete MCP server

### Fixed
- Git status parsing now correctly preserves leading spaces
- GitMonitor.close() made synchronous to resolve ESLint warning
- Command injection security enhancements in HookExecutor

### Security
- Enhanced command injection prevention with sophisticated parsing
- Detection for command substitution (backticks and $())
- Improved pattern detection for pipes, redirections, and chaining

### Changed
- Updated repository URL in package.json
- Improved error handling in Git subsystem with graceful degradation

### Development
- Phase 3 completed with full test coverage
- All 35 Git integration tests passing
- TypeScript compilation successful
- Total test count: 120 tests passing across all subsystems
- Test coverage: 78.88%

## [0.2.0] - 2025-07-25

### Added
- Phase 2: Hook System Implementation (COMPLETE)
  - HookExecutor with command sandboxing and environment isolation
  - CircuitBreaker with per-operation state management and concurrent request handling
  - HookSystem integration with pattern matching and JSON output parsing
  - Comprehensive test suite (45 tests passing)
- Additional tests for Phase 1 components
  - VectorStore tests with similarity search and persistence (17 tests)
  - FileStore tests with sharding and checksum verification (18 tests)

### Fixed
- FileStore checksum verification now properly throws errors on integrity failures
- HookExecutor command parsing handles complex commands with quotes correctly
- Node command accessibility in sandboxed environments with proper PATH handling
- CircuitBreaker concurrent operations tracking prevents exceeding failure thresholds
- TypeScript errors in test configurations

### Changed
- HookSystem uses flexible HookConfig interface separate from main configuration
- CircuitBreaker tracks both total and consecutive failures for better statistics
- Improved error handling throughout hook system with non-zero exit code detection

### Development
- Test coverage now includes all Phase 1 and Phase 2 components
- All 45 hook system tests passing
- Follows TDD Red-Green-Refactor cycle throughout implementation

## [0.1.0] - 2025-07-25

### Added
- Initial project setup with MCP server foundation
- Comprehensive 8-phase implementation plan
- CLAUDE.md for Claude Code context and guidance
- Phase 1: Storage Engine Foundation implementation (COMPLETE)
  - SQLite database layer with migration system
  - Transaction manager with rollback support
  - Storage engine with memory validation and size limits
  - Memory querying with filters, ordering, and date ranges
  - VectorStore implementation for embedding storage
  - FileStore implementation for large content with checksums
  - Comprehensive test suite (23 tests passing)
- Project configuration with environment variables
- Winston-based logging system
- TypeScript ESM configuration
- Jest testing framework setup

### Architecture
- Model Context Protocol (MCP) server for persistent memory
- Multi-layer storage: SQLite for structured data, vector store for embeddings, file store for large content
- Defensive programming with error boundaries and graceful degradation
- Workspace isolation for complete project separation
- Transactional integrity with SQLite WAL mode
- Cosine similarity search in vector store
- Content sharding in file store for scalability

### Development
- TDD approach with comprehensive test specifications
- 46% overall test coverage (Phase 1 complete, 7 phases remaining)
- ESM compatibility with .js extensions for imports
- Zod schemas for input validation
- All storage engine tests passing
- TypeScript compilation successful

[0.1.0]: https://github.com/jbbrack03/Claude_Code_Memory_MCP/releases/tag/v0.1.0