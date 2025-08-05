# WorkspaceManager and SessionManager Test Strategy

## Overview

This document outlines the comprehensive test strategy for the WorkspaceManager and SessionManager classes in the Claude Code Memory MCP Server project. The tests are designed to ensure robust functionality, error handling, and integration between these critical components.

## Test Architecture

### Test Structure
```
tests/
├── integration/
│   └── workspace-session-managers.test.ts  # Integration tests
├── workspace/
│   └── manager.test.ts                      # WorkspaceManager unit tests
├── session/
│   └── manager.test.ts                      # SessionManager unit tests
└── cli/
    └── integration.test.ts                  # CLI integration tests
```

### Test Helper Utilities

#### withTimeout Helper
All tests use a standardized `withTimeout` helper that:
- Prevents hanging tests with configurable timeouts
- Provides resource cleanup integration
- Ensures proper error handling and resource management
- Follows the project's timeout patterns established in Phase 13

#### Test Environment Setup
- Temporary directories for isolated test environments
- Mock databases using SQLite in-memory mode
- Comprehensive cleanup procedures in `afterEach` hooks
- Mock GitIntegration for controlled testing scenarios

## Test Coverage

### 1. WorkspaceManager Tests (`tests/workspace/manager.test.ts`)

#### Constructor and Initialization (2 tests)
- ✅ Create manager without GitIntegration
- ✅ Create manager with GitIntegration

#### Workspace Detection (12 tests)
**Git Workspace Detection (4 tests)**
- ✅ Detect git workspace using GitIntegration
- ✅ Fallback to manual git detection when GitIntegration fails
- ✅ Detect git workspace from subdirectory
- ✅ Handle git detection from filesystem root

**NPM Workspace Detection (2 tests)**
- ✅ Detect npm workspace by package.json
- ✅ Find package.json in parent directories

**Directory Fallback (2 tests)**
- ✅ Fallback to directory type when no git or npm found
- ✅ Use current working directory when no path provided

**Caching Behavior (4 tests)**
- ✅ Cache workspace detection results
- ✅ Use cached workspace for subdirectories
- ✅ Clear cache successfully
- ✅ Re-detect after cache clear

#### Workspace Metadata (11 tests)
**Git Workspace Metadata (3 tests)**
- ✅ Generate correct metadata for git workspace
- ✅ Handle git metadata without remote
- ✅ Handle git integration errors gracefully

**NPM Workspace Metadata (3 tests)**
- ✅ Generate correct metadata for npm workspace
- ✅ Handle corrupted package.json gracefully
- ✅ Handle package.json without name field

**Directory Workspace Metadata (1 test)**
- ✅ Generate correct metadata for directory workspace

**Metadata Caching (4 tests)**
- ✅ Cache metadata results
- ✅ Generate fresh metadata for uncached workspaces
- ✅ Handle concurrent metadata requests
- ✅ Validate metadata structure and types

#### Workspace Switching (4 tests)
- ✅ Switch to existing workspace successfully
- ✅ Throw error for non-existent workspace
- ✅ Update cache when switching workspace
- ✅ Handle switching to same workspace

#### Edge Cases and Error Handling (6 tests)
- ✅ Handle file system permission errors
- ✅ Handle very deep directory nesting
- ✅ Handle symbolic links in workspace detection
- ✅ Handle concurrent workspace operations
- ✅ Handle empty directory names gracefully
- ✅ Handle malformed file system structures

**Total WorkspaceManager Tests: 35**

### 2. SessionManager Tests (`tests/session/manager.test.ts`)

#### Constructor and Configuration (4 tests)
- ✅ Create session manager with default config
- ✅ Create session manager with custom config
- ✅ Create session manager with database
- ✅ Handle missing database gracefully when persistence enabled

#### Session ID Generation (2 tests)
- ✅ Generate unique session IDs
- ✅ Generate IDs with timestamp component

#### Session Creation (4 tests)
- ✅ Create session with required fields
- ✅ Create session with metadata
- ✅ Enforce max active sessions limit
- ✅ Persist session to database when enabled

#### Session Retrieval (4 tests)
- ✅ Retrieve existing session by ID
- ✅ Return null for non-existent session
- ✅ Return null for expired session
- ✅ Load session from database when not in memory

#### Session Lifecycle Management (8 tests)
- ✅ Get or create session for new workspace
- ✅ Reuse existing active session for workspace
- ✅ Get existing session by ID when provided
- ✅ Create new session when provided ID does not exist
- ✅ Create new session when provided ID belongs to different workspace
- ✅ Find active session for workspace
- ✅ Return null when no active session for workspace
- ✅ End session successfully
- ✅ Handle ending non-existent session gracefully

#### Session Activity and Timeout (3 tests)
- ✅ Update last activity when accessing session
- ✅ Identify expired sessions correctly
- ✅ Not expire active sessions within timeout

#### Bulk Operations (3 tests)
- ✅ Get all active sessions
- ✅ Cleanup inactive sessions
- ✅ Handle cleanup with no inactive sessions

#### Database Persistence (3 tests)
- ✅ Persist session data correctly
- ✅ Handle database unavailability gracefully
- ✅ Load active sessions from database on startup

#### Cleanup and Resource Management (3 tests)
- ✅ Start cleanup interval on initialization
- ✅ Stop cleanup interval on close
- ✅ Handle multiple close calls gracefully

#### Concurrent Operations (3 tests)
- ✅ Handle concurrent session creation for same workspace
- ✅ Handle concurrent cleanup operations
- ✅ Handle concurrent session retrieval and modification

#### Edge Cases (4 tests)
- ✅ Handle very long workspace IDs
- ✅ Handle special characters in workspace IDs
- ✅ Handle complex metadata objects
- ✅ Handle system time changes gracefully

**Total SessionManager Tests: 41**

### 3. Integration Tests (`tests/integration/workspace-session-managers.test.ts`)

#### WorkspaceManager Integration Tests (6 tests)
**Workspace Detection (5 tests)**
- ✅ Detect Git workspace correctly
- ✅ Detect NPM workspace correctly
- ✅ Fallback to directory workspace for unknown types
- ✅ Use cached workspace for subsequent calls
- ✅ Detect workspace from subdirectory

**Workspace Switching (1 test)**
- ✅ Switch workspace successfully
- ✅ Throw error when switching to non-existent workspace

**Cache Management (1 test)**
- ✅ Clear cache successfully

#### SessionManager Integration Tests (7 tests)
**Session Creation and Retrieval (4 tests)**
- ✅ Create new session for workspace
- ✅ Retrieve session by ID
- ✅ Return null for non-existent session
- ✅ Get or create session for workspace

**Session Lifecycle Management (4 tests)**
- ✅ Find active session for workspace
- ✅ End session successfully
- ✅ Get all active sessions
- ✅ Handle session persistence

**Session Timeout and Cleanup (3 tests)**
- ✅ Expire sessions after timeout
- ✅ Cleanup inactive sessions
- ✅ Enforce max active sessions limit

#### WorkspaceManager and SessionManager Integration (6 tests)
**CLI Integration Scenarios (3 tests)**
- ✅ Handle complete workspace detection and session creation workflow
- ✅ Handle workspace switching with session management
- ✅ Handle session reuse for same workspace

**Error Handling and Edge Cases (4 tests)**
- ✅ Handle workspace detection failure gracefully
- ✅ Handle concurrent session operations
- ✅ Handle session manager cleanup during workspace operations
- ✅ Handle database connection issues gracefully

**Performance and Resource Management (2 tests)**
- ✅ Handle rapid workspace switching efficiently
- ✅ Handle memory cleanup for expired sessions

**Total Integration Tests: 19**

### 4. CLI Integration Tests (`tests/cli/integration.test.ts`)

#### Context Injection Command (5 tests)
- ✅ Inject context for git workspace
- ✅ Inject context for npm workspace
- ✅ Inject context with session reuse
- ✅ Handle context injection from subdirectory
- ✅ Handle invalid arguments gracefully

#### Event Capture Command (4 tests)
- ✅ Capture event for workspace
- ✅ Capture event with session ID
- ✅ Capture manual event without tool
- ✅ Handle capture with complex content

#### Workspace and Session Integration (3 tests)
- ✅ Maintain session consistency across commands
- ✅ Handle workspace switching correctly
- ✅ Handle rapid successive commands

#### MCP Server Command (2 tests)
- ✅ Start MCP server process
- ✅ Handle server startup errors gracefully

#### Error Handling (4 tests)
- ✅ Handle unknown commands gracefully
- ✅ Handle missing workspace gracefully
- ✅ Handle malformed arguments
- ✅ Handle system interruption signals

#### Performance and Reliability (2 tests)
- ✅ Handle multiple workspaces efficiently
- ✅ Maintain consistent performance under load

**Total CLI Integration Tests: 20**

## Test Categories and Scenarios

### Positive Test Cases
- **Basic Functionality**: All core operations work as expected
- **Integration**: Components work together seamlessly
- **Performance**: Operations complete within acceptable timeframes
- **Persistence**: Data survives session restarts
- **Caching**: Optimizations work correctly

### Negative Test Cases
- **Error Handling**: Graceful handling of invalid inputs
- **Resource Constraints**: Behavior under limits and failures
- **Edge Cases**: Unusual but valid scenarios
- **Timeout Scenarios**: Expired sessions and cleanup
- **Concurrent Access**: Race condition prevention

### Boundary Test Cases
- **Resource Limits**: Maximum sessions, long paths, complex data
- **Time-based**: Session timeouts, activity updates
- **File System**: Deep nesting, special characters, permissions
- **Network**: Git remote handling, connectivity issues

## Test Execution Strategy

### Test Organization
- **Unit Tests**: Fast, isolated component testing
- **Integration Tests**: Component interaction validation  
- **CLI Tests**: End-to-end workflow verification
- **Performance Tests**: Load and efficiency validation

### Test Data Management
- **Temporary Directories**: Isolated test environments
- **Mock Databases**: In-memory SQLite for fast tests
- **Cleanup Procedures**: Comprehensive resource cleanup
- **Deterministic Data**: Predictable test scenarios

### Error Scenarios Covered
1. **File System Errors**: Permission denied, path not found
2. **Database Errors**: Connection failures, corruption
3. **Git Integration Errors**: Repository issues, remote failures
4. **Session Timeout**: Expired sessions, cleanup failures
5. **Concurrent Access**: Race conditions, resource conflicts
6. **Resource Exhaustion**: Memory limits, session limits
7. **Invalid Input**: Malformed data, missing parameters
8. **System Interruption**: Process signals, unexpected shutdown

## Success Criteria

### Coverage Requirements
- **Unit Test Coverage**: 100% for critical paths
- **Integration Coverage**: All component interactions
- **Error Path Coverage**: All error scenarios handled
- **Performance Coverage**: Response time requirements met

### Quality Metrics
- **Test Reliability**: No flaky tests, consistent results
- **Test Performance**: All tests complete within timeouts
- **Resource Management**: No memory leaks or hanging resources
- **Error Handling**: Graceful degradation in all failure modes

### Compliance Standards
- **Given/When/Then**: Clear test structure
- **Timeout Protection**: All tests use withTimeout helper
- **Resource Cleanup**: Proper cleanup in all scenarios
- **Deterministic Results**: Tests produce consistent outcomes

## Test Execution and Maintenance

### Running Tests
```bash
# Run all workspace/session tests
npm test tests/workspace tests/session tests/integration

# Run specific test suites
npm test tests/workspace/manager.test.ts
npm test tests/session/manager.test.ts
npm test tests/integration/workspace-session-managers.test.ts
npm test tests/cli/integration.test.ts

# Run with coverage
npm run test:coverage
```

### Continuous Integration
- Tests run on all pull requests
- Coverage thresholds enforced (80% minimum)
- Performance regression detection
- Resource leak detection

### Maintenance Guidelines
- Update tests when adding new features
- Maintain timeout values appropriate for CI environments
- Keep mock data synchronized with real implementations
- Regular review of test performance and reliability

## Summary

This comprehensive test strategy ensures that the WorkspaceManager and SessionManager classes are thoroughly validated across all scenarios:

- **Total Test Count**: 115 tests
- **Coverage Areas**: Unit, Integration, CLI, Error Handling, Performance
- **Test Categories**: Positive, Negative, Boundary, Concurrent
- **Quality Assurance**: Timeout protection, resource management, deterministic results

The test suite provides confidence in the robustness and reliability of the workspace and session management functionality, supporting the project's commitment to production-ready code quality.