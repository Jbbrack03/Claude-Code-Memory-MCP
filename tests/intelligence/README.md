# Intelligence Layer Tests

This directory contains tests for the intelligence layer components.

## Test Organization

### EmbeddingGenerator Tests

The EmbeddingGenerator tests are split into two files to properly test different behaviors:

1. **embeddings-test-mode.test.ts**
   - Tests the built-in test mode behavior (NODE_ENV='test')
   - Verifies that models are not downloaded from external sources
   - Ensures deterministic embeddings are generated
   - Tests performance in test mode

2. **embeddings-production.test.ts**
   - Tests the production logic with mocked @xenova/transformers
   - Verifies integration with the transformers pipeline
   - Tests error handling and edge cases
   - Uses NODE_ENV='development' to bypass test mode

## Running Tests

```bash
# Run all intelligence tests
npm test tests/intelligence/

# Run only test mode tests
npm test tests/intelligence/embeddings-test-mode.test.ts

# Run only production logic tests
npm test tests/intelligence/embeddings-production.test.ts
```

## Test Environment

- Both test files use the Node.js test environment (`@jest-environment node`)
- The production tests temporarily set NODE_ENV='development' to test the actual pipeline integration
- The test mode tests ensure NODE_ENV='test' to verify the mock behavior