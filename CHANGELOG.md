# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-07-25

### Added
- Initial project setup with MCP server foundation
- Comprehensive 8-phase implementation plan
- CLAUDE.md for Claude Code context and guidance
- Phase 1: Storage Engine Foundation implementation
  - SQLite database layer with migration system
  - Transaction manager with rollback support
  - Storage engine with memory validation and size limits
  - Comprehensive test suite (18 tests passing)
- Project configuration with environment variables
- Winston-based logging system
- TypeScript ESM configuration
- Jest testing framework setup

### Architecture
- Model Context Protocol (MCP) server for persistent memory
- Multi-layer storage: SQLite for structured data, planned vector DB for embeddings
- Defensive programming with error boundaries and graceful degradation
- Workspace isolation for complete project separation
- Transactional integrity with SQLite WAL mode

### Development
- TDD approach with comprehensive test specifications
- 90% test coverage for implemented storage components
- ESM compatibility with .js extensions for imports
- Zod schemas for input validation

[0.1.0]: https://github.com/jbbrack03/Claude_Code_Memory_MCP/releases/tag/v0.1.0