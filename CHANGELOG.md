# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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