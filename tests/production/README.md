# Production Hardening Tests

This directory contains comprehensive tests for production-ready features in the Claude Memory MCP server.

## Test Suites

### 1. Rate Limiting Tests (`rate-limiting.test.ts`)
Tests the request throttling and API protection mechanisms.

**Key Features Tested:**
- Sliding window and fixed window rate limiting
- Per-client rate limits
- Burst traffic handling
- Concurrent request handling
- TTL and cleanup mechanisms
- Integration with MCP server endpoints
- Proper retry headers and error responses

**Performance Requirements:**
- Rate limit checks: < 10ms per operation
- Cleanup: < 100ms for 1000 entries
- Handle 1000+ concurrent requests

### 2. Scalable Vector Index Tests (`scalable-vector-index.test.ts`)
Tests the high-performance vector operations using hnswlib-node.

**Key Features Tested:**
- O(log n) search performance with large datasets (10k+ vectors)
- Incremental index updates
- Memory-efficient operations
- Concurrent add/search operations
- Persistence and recovery
- Accuracy compared to standard implementation

**Performance Requirements:**
- Search: < 200ms p95 latency
- Add: < 100ms per vector
- Batch: < 1s for 1000 vectors

### 3. Git Remote Tracking Tests (`git-remote-tracking.test.ts`)
Tests repository synchronization and remote tracking functionality.

**Key Features Tested:**
- Remote branch tracking (ahead/behind counts)
- Diverged branch detection
- Multiple branch support
- Disconnected scenario handling
- Shallow clone support
- Rebase and force push scenarios

**Performance Requirements:**
- Status checks: < 50ms (cached)
- Remote fetch: < 500ms (uncached)

### 4. Vector Similarity Search Tests (`vector-similarity-search.test.ts`)
End-to-end tests for semantic search through the full stack.

**Key Features Tested:**
- Semantic search across stored memories
- Multilingual content support
- Sub-200ms search latency with 10k memories
- Filtered similarity search
- Query expansion and synonym handling
- Context building from search results
- Error handling and resilience

**Performance Requirements:**
- Search latency: < 200ms with 10k memories
- Concurrent searches: 20+ simultaneous queries
- Context building: < 500ms

## Running the Tests

### Run All Production Tests
```bash
npm test tests/production/
```

### Run Individual Test Suites
```bash
# Rate limiting tests
npm test tests/production/rate-limiting.test.ts

# Scalable vector index tests
npm test tests/production/scalable-vector-index.test.ts

# Git remote tracking tests
npm test tests/production/git-remote-tracking.test.ts

# Vector similarity search tests
npm test tests/production/vector-similarity-search.test.ts
```

### Run Specific Tests
```bash
# Run tests matching a pattern
npm test tests/production/ -- --testNamePattern="should handle burst traffic"

# Run with coverage
npm test tests/production/ -- --coverage
```

## Test Environment Requirements

1. **File System Access**: Tests create temporary directories in `/tmp/`
2. **Git**: Required for git-remote-tracking tests
3. **Memory**: Some tests allocate significant memory for performance testing
4. **CPU**: Performance tests may be CPU-intensive

## CI/CD Considerations

When running in CI/CD:
1. Ensure sufficient resources (2+ CPU cores, 4GB+ RAM)
2. Consider using test timeouts for performance tests
3. Some tests may need to be marked as integration tests
4. Git tests require git to be installed in the container

## Debugging Failed Tests

1. **Check logs**: Tests output detailed logs for debugging
2. **Run individually**: Isolate failing tests to avoid interference
3. **Check resources**: Ensure sufficient disk space and memory
4. **Verify dependencies**: Ensure all system dependencies are installed