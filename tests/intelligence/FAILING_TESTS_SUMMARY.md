# IntelligenceLayer Failing Tests Summary

This document summarizes the failing tests written for the IntelligenceLayer implementation following TDD practices.

## Test Files Created

1. **tests/intelligence/layer-tdd.test.ts** - Runnable tests demonstrating expected failures
2. **tests/intelligence/layer-failing.test.ts** - Comprehensive tests with TypeScript errors (requires implementation)
3. **tests/intelligence/layer.test.ts** - Original test file with skipped sections for future implementation

## Key Failing Test Categories

### 1. Current Implementation Gaps (5 failures)
- ❌ Should have method to set storage engine dependency
- ❌ Should have method to set embedding generator dependency  
- ❌ Should have internal vector store after initialization
- ❌ Should have internal context builder after initialization
- ❌ Should have query cache when caching is enabled

### 2. buildContext Implementation (4 failures)
- ❌ Should return formatted context string
- ❌ Should include metadata when configured
- ❌ Should respect maxSize configuration
- ❌ Should handle empty memories array

### 3. Advanced Features (in layer-failing.test.ts)
- ❌ Constructor should accept StorageEngine and EmbeddingGenerator
- ❌ Should perform vector search with generated embeddings
- ❌ Should fall back to SQL when vector store unavailable
- ❌ Should cache query results when enabled
- ❌ Should meet performance requirements (<200ms)

## Implementation Requirements

Based on the failing tests, the IntelligenceLayer needs:

### 1. Constructor Changes
```typescript
constructor(
  config: Config["intelligence"],
  storageEngine?: StorageEngine,
  embeddingGenerator?: EmbeddingGenerator
)
```

### 2. Dependency Injection Methods
- `setStorageEngine(engine: StorageEngine): void`
- `setEmbeddingGenerator(generator: EmbeddingGenerator): void`

### 3. Internal Components
- `vectorStore: VectorStore | null`
- `contextBuilder: ContextBuilder`
- `queryCache: Map<string, CachedResult>`
- `embeddingGenerator: EmbeddingGenerator`

### 4. Core Functionality

#### retrieveMemories() Implementation:
1. Generate embedding for query using EmbeddingGenerator
2. Search vector store with embedding
3. Fall back to SQL search if vector store unavailable
4. Calculate text similarity scores for SQL results
5. Apply filters and sorting
6. Cache results if enabled
7. Return formatted RetrievedMemory objects

#### buildContext() Implementation:
1. Use ContextBuilder to format memories
2. Respect configuration options (maxSize, includeMetadata)
3. Handle deduplication
4. Return formatted markdown/plain text

### 5. Performance Requirements
- Memory retrieval: < 200ms (p95)
- Context building: < 200ms (p95)
- Implement query result caching
- Batch processing for efficiency

### 6. Error Handling
- Graceful fallback when vector store unavailable
- Handle embedding generation failures
- Clear error messages for uninitialized state

## Running the Tests

```bash
# Run all TDD tests (see failures)
npm test tests/intelligence/layer-tdd.test.ts

# Run specific test suites
npm test tests/intelligence/layer-tdd.test.ts -- --testNamePattern="Current implementation gaps"
npm test tests/intelligence/layer-tdd.test.ts -- --testNamePattern="buildContext implementation"

# Run original tests (many skipped)
npm test tests/intelligence/layer.test.ts
```

## Next Steps

1. Update IntelligenceLayer constructor to accept dependencies
2. Implement dependency injection methods
3. Create and initialize internal components
4. Implement retrieveMemories() with vector search
5. Implement SQL fallback functionality
6. Integrate ContextBuilder for formatting
7. Add query caching with TTL
8. Ensure performance requirements are met

All tests are properly failing in the red phase of TDD, providing clear guidance for implementation.