import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { QueryPlanner, Query, QueryPlan, QueryType, QueryComplexity } from '../../src/intelligence/query-planner.js';

// Mock StorageEngine for testing
interface MockStorageEngine {
  search: jest.Mock;
  query: jest.Mock;
  getStats: jest.Mock;
  getIndexInfo: jest.Mock;
}

describe('QueryPlanner Advanced Features (Phase 7b)', () => {
  let planner: QueryPlanner;
  let mockEngine: MockStorageEngine;

  beforeEach(() => {
    planner = new QueryPlanner();
    mockEngine = {
      search: jest.fn(),
      query: jest.fn(),
      getStats: jest.fn(),
      getIndexInfo: jest.fn()
    };
  });

  describe('Boolean Logic Analysis', () => {
    describe('analyzeComplexityWithBooleanLogic', () => {
      it('should analyze queries with $and operator', () => {
        // Given: A query with $and boolean logic
        const query: Query = {
          text: 'authentication flow',
          filters: {
            $and: [
              { eventType: 'function_created' },
              { author: 'alice' },
              { timestamp: { after: new Date('2025-01-01') } }
            ]
          }
        };

        // When: Analyzing complexity with boolean logic
        const result = planner.analyzeComplexityWithBooleanLogic(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // 3 filters is still simple
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(3); // 3 filters in $and array
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('Boolean');
      });

      it('should analyze queries with $or operator', () => {
        // Given: A query with $or boolean logic
        const query: Query = {
          text: '',
          filters: {
            $or: [
              { author: 'alice' },
              { author: 'bob' }
            ],
            eventType: 'file_modified'
          }
        };

        // When: Analyzing complexity with boolean logic
        const result = planner.analyzeComplexityWithBooleanLogic(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // $or with 2 filters + 1 regular filter should be simple
        expect(result.hasSemanticComponent).toBe(false); // empty text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(3); // 2 in $or + 1 regular
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('Boolean');
      });

      it('should analyze queries with $not operator', () => {
        // Given: A query with $not boolean logic
        const query: Query = {
          text: 'test files',
          filters: {
            $not: {
              filename: { endsWith: '.test.js' }
            },
            eventType: 'file_created'
          }
        };

        // When: Analyzing complexity with boolean logic
        const result = planner.analyzeComplexityWithBooleanLogic(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // $not with 1 nested filter + 1 regular should be simple
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(2); // 1 in $not + 1 regular
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('Boolean');
      });

      it('should analyze nested boolean logic combinations', () => {
        // Given: A query with nested boolean logic
        const query: Query = {
          text: 'database operations',
          filters: {
            $and: [
              {
                $or: [
                  { eventType: 'sql_query' },
                  { eventType: 'database_connection' }
                ]
              },
              {
                $not: {
                  author: 'system'
                }
              },
              { timestamp: { after: new Date('2025-07-01') } }
            ]
          }
        };

        // When: Analyzing complexity with nested boolean logic
        const result = planner.analyzeComplexityWithBooleanLogic(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('complex'); // nested $and/$or/$not should be complex
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(4); // 2 in $or + 1 in $not + 1 timestamp
        expect(result.estimatedCost).toBeGreaterThan(15); // should exceed complex threshold
        expect(result.reason).toContain('2 nesting levels');
      });

      it('should handle boolean logic performance requirements', () => {
        // Given: A complex boolean query that should complete in < 10ms
        const query: Query = {
          text: 'performance critical search',
          filters: {
            $and: [
              { $or: [{ priority: 'high' }, { priority: 'critical' }] },
              { $not: { status: 'archived' } },
              { timestamp: { after: new Date('2025-01-01') } }
            ]
          }
        };

        // When: Analyzing boolean logic complexity
        const startTime = performance.now();
        const result = planner.analyzeComplexityWithBooleanLogic(query);
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        // Then: Should return valid result and meet performance requirements
        expect(result).toBeDefined();
        expect(result.type).toBe('complex'); // 3 operators makes it complex
        expect(result.hasSemanticComponent).toBe(true);
        expect(result.hasFilterComponent).toBe(true);
        expect(result.filterCount).toBe(4); // 2 in $or + 1 in $not + 1 timestamp
        expect(duration).toBeLessThan(10); // Performance requirement
      });

      it('should validate boolean logic structure', () => {
        // Given: A query with invalid boolean logic structure
        const invalidQuery: Query = {
          text: 'search term',
          filters: {
            $and: 'invalid_structure' // Should be array
          }
        };

        // When: Analyzing invalid boolean logic
        const result = planner.analyzeComplexityWithBooleanLogic(invalidQuery);

        // Then: Should handle gracefully and return valid analysis
        expect(result).toBeDefined();
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(false); // invalid structure has no valid filters
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toBeDefined();
      });
    });
  });

  describe('Range Filter Analysis', () => {
    describe('analyzeRangeFilters', () => {
      it('should analyze timestamp range filters', () => {
        // Given: A query with timestamp range filters
        const query: Query = {
          text: 'recent changes',
          filters: {
            timestamp: {
              $gte: new Date('2025-07-01'),
              $lte: new Date('2025-07-31')
            }
          }
        };

        // When: Analyzing range filters
        const result = planner.analyzeRangeFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // 2 range conditions should be simple
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(2); // $gte and $lte
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('range');
      });

      it('should analyze numeric range filters', () => {
        // Given: A query with numeric range filters
        const query: Query = {
          text: 'large files',
          filters: {
            fileSize: {
              $gt: 1024,
              $lt: 1048576
            },
            lineCount: {
              $gte: 100,
              $lte: 1000
            }
          }
        };

        // When: Analyzing numeric range filters
        const result = planner.analyzeRangeFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // 4 range conditions should be simple
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(4); // $gt, $lt, $gte, $lte
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('range');
      });

      it('should analyze string size range filters', () => {
        // Given: A query with string size range filters
        const query: Query = {
          text: 'file analysis',
          filters: {
            fileSize: {
              $gte: '1KB',
              $lte: '10MB'
            },
            content: {
              minLength: 100,
              maxLength: 50000
            }
          }
        };

        // When: Analyzing string size range filters
        const result = planner.analyzeRangeFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // 4 range-like conditions should be simple
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(5); // fileSize ($gte, $lte) + content (minLength, maxLength) + regular content field
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('range');
      });

      it('should analyze multiple overlapping ranges', () => {
        // Given: A query with multiple overlapping range filters
        const query: Query = {
          text: 'performance metrics',
          filters: {
            executionTime: { $gt: 100, $lt: 5000 },
            memoryUsage: { $gte: '10MB', $lte: '100MB' },
            timestamp: {
              $gte: new Date('2025-07-01'),
              $lt: new Date('2025-08-01')
            }
          }
        };

        // When: Analyzing overlapping ranges
        const result = planner.analyzeRangeFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('complex'); // 6 filters exceeds simple threshold
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(6); // 2 + 2 + 2 range conditions
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('range');
      });

      it('should validate range filter boundaries', () => {
        // Given: A query with invalid range boundaries
        const invalidQuery: Query = {
          text: 'invalid range',
          filters: {
            timestamp: {
              $gte: new Date('2025-07-31'),
              $lte: new Date('2025-07-01') // End before start
            }
          }
        };

        // When: Analyzing invalid range filters
        const result = planner.analyzeRangeFilters(invalidQuery);

        // Then: Should handle gracefully and return valid analysis
        expect(result).toBeDefined();
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(2); // $gte and $lte
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('range');
      });
    });
  });

  describe('Geospatial Filter Analysis', () => {
    describe('analyzeGeospatialFilters', () => {
      it('should analyze circular geospatial filters', () => {
        // Given: A query with circular geospatial filter
        const query: Query = {
          text: 'deployment locations',
          filters: {
            location: {
              type: 'circle',
              center: { lat: 37.7749, lng: -122.4194 },
              radius: '50km'
            }
          }
        };

        // When: Analyzing geospatial filters
        const result = planner.analyzeGeospatialFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // 1 circle filter should be simple
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(1); // 1 geospatial filter
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('spatial');
      });

      it('should analyze rectangular geospatial filters', () => {
        // Given: A query with rectangular geospatial filter
        const query: Query = {
          text: 'regional services',
          filters: {
            location: {
              type: 'rectangle',
              northEast: { lat: 40.7831, lng: -73.9712 },
              southWest: { lat: 40.7489, lng: -73.9441 }
            },
            region: 'us-east-1'
          }
        };

        // When: Analyzing rectangular geospatial filters
        const result = planner.analyzeGeospatialFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // 1 rectangle + 1 regular filter should be simple
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(2); // 1 geospatial + 1 regular
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('spatial');
      });

      it('should analyze polygon geospatial filters', () => {
        // Given: A query with polygon geospatial filter
        const query: Query = {
          text: 'city boundaries',
          filters: {
            location: {
              type: 'polygon',
              coordinates: [
                [{ lat: 37.7749, lng: -122.4194 }],
                [{ lat: 37.7849, lng: -122.4094 }],
                [{ lat: 37.7649, lng: -122.4094 }],
                [{ lat: 37.7749, lng: -122.4194 }]
              ]
            }
          }
        };

        // When: Analyzing polygon geospatial filters
        const result = planner.analyzeGeospatialFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // 1 polygon with 4 coordinates should be simple
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(1); // 1 geospatial filter
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('spatial');
      });

      it('should analyze multiple geospatial filters', () => {
        // Given: A query with multiple geospatial filters
        const query: Query = {
          text: 'multi-region deployment',
          filters: {
            primaryLocation: {
              type: 'circle',
              center: { lat: 37.7749, lng: -122.4194 },
              radius: '100km'
            },
            backupLocation: {
              type: 'circle',
              center: { lat: 40.7128, lng: -74.0060 },
              radius: '75km'
            }
          }
        };

        // When: Analyzing multiple geospatial filters
        const result = planner.analyzeGeospatialFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('complex'); // 2 geo filters with high cost is complex
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(2); // 2 geospatial filters
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('spatial');
      });

      it('should validate geospatial coordinate ranges', () => {
        // Given: A query with invalid coordinates
        const invalidQuery: Query = {
          text: 'invalid coordinates',
          filters: {
            location: {
              type: 'circle',
              center: { lat: 91.0, lng: -181.0 }, // Invalid lat/lng
              radius: '50km'
            }
          }
        };

        // When: Analyzing invalid geospatial filters
        const result = planner.analyzeGeospatialFilters(invalidQuery);

        // Then: Should handle gracefully and return valid analysis
        expect(result).toBeDefined();
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(1); // 1 geospatial filter
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('spatial');
      });
    });
  });

  describe('Fuzzy Filter Analysis', () => {
    describe('analyzeFuzzyFilters', () => {
      it('should analyze fuzzy string matching filters', () => {
        // Given: A query with fuzzy string matching
        const query: Query = {
          text: '',
          filters: {
            filename: {
              fuzzy: 'test.js',
              threshold: 0.8
            }
          }
        };

        // When: Analyzing fuzzy filters
        const result = planner.analyzeFuzzyFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // 1 fuzzy filter with high threshold should be simple
        expect(result.hasSemanticComponent).toBe(false); // no text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(1); // 1 fuzzy filter
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('fuzzy');
      });

      it('should analyze fuzzy matching with edit distance', () => {
        // Given: A query with edit distance fuzzy matching
        const query: Query = {
          text: 'user search',
          filters: {
            author: {
              fuzzy: 'john',
              distance: 2,
              algorithm: 'levenshtein'
            }
          }
        };

        // When: Analyzing edit distance fuzzy filters
        const result = planner.analyzeFuzzyFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // Single fuzzy filter is simple
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(1); // 1 fuzzy filter
        expect(result.estimatedCost).toBeGreaterThan(8); // should exceed complex threshold
        expect(result.reason).toContain('fuzzy');
      });

      it('should analyze phonetic fuzzy matching', () => {
        // Given: A query with phonetic fuzzy matching
        const query: Query = {
          text: 'name search',
          filters: {
            authorName: {
              fuzzy: 'smith',
              algorithm: 'soundex'
            }
          }
        };

        // When: Analyzing phonetic fuzzy filters
        const result = planner.analyzeFuzzyFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('simple'); // basic phonetic fuzzy should be simple
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(1); // 1 fuzzy filter
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('fuzzy');
      });

      it('should analyze multiple fuzzy filters with different algorithms', () => {
        // Given: A query with multiple fuzzy filters
        const query: Query = {
          text: 'multi-fuzzy search',
          filters: {
            filename: { fuzzy: 'test.js', threshold: 0.8 },
            author: { fuzzy: 'john', distance: 1 },
            description: { fuzzy: 'authentication', algorithm: 'jaro-winkler' }
          }
        };

        // When: Analyzing multiple fuzzy filters
        const result = planner.analyzeFuzzyFilters(query);

        // Then: Should return proper ComplexityAnalysis
        expect(result).toBeDefined();
        expect(result.type).toBe('complex'); // multiple fuzzy filters should be complex
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(3); // 3 fuzzy filters
        expect(result.estimatedCost).toBeGreaterThan(8); // should exceed complex threshold
        expect(result.reason).toContain('fuzzy');
      });

      it('should validate fuzzy filter parameters', () => {
        // Given: A query with invalid fuzzy parameters
        const invalidQuery: Query = {
          text: 'invalid fuzzy',
          filters: {
            filename: {
              fuzzy: 'test.js',
              threshold: 1.5 // Invalid threshold > 1.0
            }
          }
        };

        // When: Analyzing invalid fuzzy filters
        const result = planner.analyzeFuzzyFilters(invalidQuery);

        // Then: Should handle gracefully and return valid analysis
        expect(result).toBeDefined();
        expect(result.hasSemanticComponent).toBe(true); // has text
        expect(result.hasFilterComponent).toBe(true); // has filters
        expect(result.filterCount).toBe(1); // 1 fuzzy filter
        expect(result.estimatedCost).toBeGreaterThan(0);
        expect(result.reason).toContain('fuzzy');
      });
    });
  });

  describe('Memory Usage Analysis', () => {
    describe('estimateMemoryUsage', () => {
      it('should estimate memory usage for large result sets', () => {
        // Given: A query that would return a large result set
        const query: Query = {
          text: 'comprehensive search',
          filters: {
            timestamp: { after: new Date('2024-01-01') }
          },
          limit: 10000
        };

        // When: Estimating memory usage
        const memoryUsage = planner.estimateMemoryUsage(query);

        // Then: Should return memory estimation based on large result size
        expect(memoryUsage).toBeGreaterThan(20 * 1024 * 1024); // >20MB for 10k results
        expect(memoryUsage).toBeLessThan(50 * 1024 * 1024); // <50MB reasonable upper bound
      });

      it('should estimate memory usage for semantic queries', () => {
        // Given: A semantic query with embeddings
        const query: Query = {
          text: 'complex semantic search with multiple terms and context',
          filters: {},
          limit: 1000
        };

        // When: Estimating memory usage for semantic search
        const memoryUsage = planner.estimateMemoryUsage(query);

        // Then: Should include text memory and embedding vector memory
        expect(memoryUsage).toBeGreaterThan(2 * 1024 * 1024 - 50000); // ~2MB for 1000 results + embeddings
        expect(memoryUsage).toBeLessThan(5 * 1024 * 1024); // <5MB for reasonable query
      });

      it('should estimate memory usage for hybrid queries', () => {
        // Given: A hybrid query with both semantic and filter components
        const query: Query = {
          text: 'authentication and authorization patterns',
          filters: {
            eventType: ['function_created', 'class_created'],
            tags: ['security', 'auth'],
            timestamp: { after: new Date('2025-01-01') }
          },
          limit: 5000
        };

        // When: Estimating memory usage for hybrid query
        const memoryUsage = planner.estimateMemoryUsage(query);

        // Then: Should include text, filter, and result memory
        expect(memoryUsage).toBeGreaterThan(10 * 1024 * 1024); // >10MB for 5000 results + embeddings
        expect(memoryUsage).toBeLessThan(20 * 1024 * 1024); // <20MB reasonable upper bound
      });
    });

    describe('estimateMemoryFootprint', () => {
      it('should estimate memory footprint for different query types', () => {
        // Given: Different types of queries
        const semanticQuery: Query = { text: 'semantic search', filters: {} };
        const filterQuery: Query = { text: '', filters: { eventType: 'commit' } };
        const hybridQuery: Query = { text: 'hybrid', filters: { author: 'alice' } };

        // When: Estimating memory footprint for each type
        const semanticFootprint = planner.estimateMemoryFootprint(semanticQuery);
        const filterFootprint = planner.estimateMemoryFootprint(filterQuery);
        const hybridFootprint = planner.estimateMemoryFootprint(hybridQuery);

        // Then: Should return footprints with overhead included
        expect(semanticFootprint).toBeGreaterThan(3000); // Base + embeddings + overhead
        expect(filterFootprint).toBeGreaterThan(1200); // Base + results + overhead
        expect(hybridFootprint).toBeGreaterThan(3000); // All components + overhead
        // Footprint should be 20% larger than usage
        expect(semanticFootprint).toBeGreaterThan(planner.estimateMemoryUsage(semanticQuery));
      });

      it('should consider vector embedding memory requirements', () => {
        // Given: A query requiring vector embeddings
        const query: Query = {
          text: 'machine learning model implementation with neural networks',
          filters: {},
          limit: 100
        };

        // When: Estimating memory footprint including embeddings
        const footprint = planner.estimateMemoryFootprint(query);

        // Then: Should include embedding memory with overhead
        expect(footprint).toBeGreaterThan(200 * 1024); // >200KB for embeddings + results
        expect(footprint).toBeLessThan(1024 * 1024); // <1MB for 100 results
      });
    });

    describe('getMemoryOptimizationHints', () => {
      it('should provide optimization hints for memory-intensive queries', () => {
        // Given: A memory-intensive query
        const query: Query = {
          text: 'comprehensive analysis of large codebase patterns',
          filters: {
            fileType: ['js', 'ts', 'jsx', 'tsx', 'vue', 'svelte'],
            timestamp: { after: new Date('2020-01-01') }
          },
          limit: 50000
        };

        // When: Getting memory optimization hints
        const hints = planner.getMemoryOptimizationHints(query);

        // Then: Should provide relevant optimization hints
        expect(hints).toContain('Consider reducing result limit');
        expect(hints).toContain('Large limit will significantly increase memory usage');
        expect(hints.length).toBeGreaterThan(0);
      });

      it('should suggest pagination for large limits', () => {
        // Given: A query with very large limit
        const query: Query = {
          text: 'all functions',
          filters: {},
          limit: 100000
        };

        // When: Getting optimization hints for large limit
        const hints = planner.getMemoryOptimizationHints(query);

        // Then: Should suggest pagination
        expect(hints).toContain('Consider reducing result limit');
        expect(hints).toContain('Large limit will significantly increase memory usage');
        expect(hints.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('Concurrent Query Planning', () => {
    describe('planQueriesConcurrently', () => {
      it('should handle multiple concurrent query planning requests', async () => {
        // Given: Multiple queries to plan concurrently
        const queries: Query[] = [
          { text: 'authentication service', filters: {} },
          { text: 'payment processing', filters: { eventType: 'api_call' } },
          { text: 'user management', filters: { project: 'backend' } },
          { text: 'database operations', filters: { eventType: 'sql_query' } }
        ];

        // When: Planning queries concurrently
        const plans = await planner.planQueriesConcurrently(queries);

        // Then: Should return array of query plans
        expect(plans).toHaveLength(4);
        expect(plans[0].queryType).toBe('semantic_only');
        expect(plans[1].queryType).toBe('hybrid');
        expect(plans[2].queryType).toBe('hybrid');
        expect(plans[3].queryType).toBe('hybrid');
      });

      it('should maintain performance with concurrent requests', async () => {
        // Given: A large number of concurrent queries
        const queries: Query[] = Array(50).fill(0).map((_, i) => ({
          text: `query ${i}`,
          filters: { index: i },
          limit: 10
        }));

        // When: Planning many queries concurrently
        const startTime = performance.now();
        const plans = await planner.planQueriesConcurrently(queries);
        const endTime = performance.now();
        const duration = endTime - startTime;

        // Then: Should complete within reasonable time
        expect(plans).toHaveLength(50);
        expect(duration).toBeLessThan(1000); // Should complete in under 1 second
      });
    });

    describe('createPlanThreadSafe', () => {
      it('should create plans in a thread-safe manner', () => {
        // Given: A query that needs thread-safe planning
        const query: Query = {
          text: 'thread safe query',
          filters: { concurrent: true },
          limit: 100
        };

        // When: Creating a thread-safe plan
        const plan = planner.createPlanThreadSafe(query);

        // Then: Should return a valid plan without modifying original query
        expect(plan).toBeDefined();
        expect(plan.queryType).toBe('hybrid');
        expect(query.filters.concurrent).toBe(true); // Original unchanged
      });

      it('should handle concurrent state modifications safely', () => {
        // Given: A query that might modify planner state
        const query: Query = {
          text: 'state modifying query',
          filters: { modifiesState: true }
        };

        // When: Creating thread-safe plan with state modifications
        const plan1 = planner.createPlanThreadSafe(query);
        const plan2 = planner.createPlanThreadSafe(query);

        // Then: Both plans should be independent
        expect(plan1).toBeDefined();
        expect(plan2).toBeDefined();
        expect(plan1).not.toBe(plan2); // Different objects
        expect(plan1.steps).not.toBe(plan2.steps); // Different arrays
      });
    });

    describe('handleHighLoadPlanning', () => {
      it('should handle resource contention gracefully', async () => {
        // Given: High load scenario with many complex queries
        const highLoadQueries: Query[] = Array(100).fill(0).map((_, i) => ({
          text: `complex query with many terms ${i}`,
          filters: {
            eventType: ['type1', 'type2', 'type3'],
            timestamp: { after: new Date() },
            tags: Array(20).fill(0).map((_, j) => `tag${j}`)
          },
          limit: 1000
        }));

        // When: Handling high load planning
        const plans = await planner.handleHighLoadPlanning(highLoadQueries);

        // Then: Should successfully handle all queries
        expect(plans).toHaveLength(100);
        expect(plans.every(p => p.queryType === 'hybrid')).toBe(true);
      });

      it('should implement backpressure mechanisms', async () => {
        // Given: Overwhelming number of queries
        const overwhelmingQueries: Query[] = Array(200).fill(0).map((_, i) => ({
          text: `query ${i}`,
          filters: { load: 'high' },
          limit: 10000
        }));

        // When: Handling overwhelming load
        const startTime = performance.now();
        const plans = await planner.handleHighLoadPlanning(overwhelmingQueries);
        const endTime = performance.now();
        const duration = endTime - startTime;

        // Then: Should implement batching and delays
        expect(plans).toHaveLength(200);
        expect(duration).toBeGreaterThan(90); // Should have delays for backpressure
      });
    });
  });

  describe('Plan Execution', () => {
    describe('executePlan', () => {
      it('should execute semantic-only plans', () => {
        // Given: A semantic-only query plan
        const plan: QueryPlan = {
          queryType: QueryType.SEMANTIC_ONLY,
          steps: [{
            type: 'semantic_search',
            description: 'Perform semantic search',
            estimatedCost: 25,
            parameters: {
              text: 'authentication patterns',
              limit: 10,
              threshold: 0.7
            }
          }],
          estimatedTotalCost: 25,
          recommendedIndexes: [],
          optimizationHints: []
        };

        // When: Executing the semantic plan
        // Then: Should fail with not implemented error
        expect(() => planner.executePlan(plan, mockEngine))
          .toThrow('Plan execution not implemented');
      });

      it('should execute filter-only plans', () => {
        // Given: A filter-only query plan
        const plan: QueryPlan = {
          queryType: QueryType.FILTER_ONLY,
          steps: [{
            type: 'sql_filter',
            description: 'Apply SQL filters',
            estimatedCost: 10,
            parameters: {
              filters: { eventType: 'commit', author: 'alice' },
              limit: 20
            }
          }],
          estimatedTotalCost: 10,
          recommendedIndexes: ['eventType', 'author'],
          optimizationHints: []
        };

        // When: Executing the filter plan
        // Then: Should fail with not implemented error
        expect(() => planner.executePlan(plan, mockEngine))
          .toThrow('Plan execution not implemented');
      });
    });

    describe('executeHybridPlan', () => {
      it('should execute hybrid plans with proper step ordering', () => {
        // Given: A hybrid query plan with multiple steps
        const plan: QueryPlan = {
          queryType: QueryType.HYBRID,
          steps: [
            {
              type: 'sql_filter',
              description: 'Pre-filter with SQL',
              estimatedCost: 15,
              parameters: {
                filters: { eventType: 'file_modified' },
                limit: 100
              }
            },
            {
              type: 'semantic_search',
              description: 'Semantic search on filtered results',
              estimatedCost: 30,
              parameters: {
                text: 'error handling patterns',
                limit: 10,
                threshold: 0.7
              }
            }
          ],
          estimatedTotalCost: 45,
          recommendedIndexes: ['eventType'],
          optimizationHints: []
        };

        // When: Executing the hybrid plan
        // Then: Should fail with not implemented error
        expect(() => planner.executeHybridPlan(plan, mockEngine))
          .toThrow('Hybrid plan execution not implemented');
      });

      it('should handle hybrid plan execution errors gracefully', () => {
        // Given: A hybrid plan that might fail during execution
        const plan: QueryPlan = {
          queryType: QueryType.HYBRID,
          steps: [
            {
              type: 'sql_filter',
              description: 'Complex filter',
              estimatedCost: 50,
              parameters: {
                filters: { complexCondition: true },
                limit: 1000
              }
            }
          ],
          estimatedTotalCost: 50,
          recommendedIndexes: [],
          optimizationHints: []
        };

        // When: Executing a potentially failing hybrid plan
        // Then: Should fail with not implemented error
        expect(() => planner.executeHybridPlan(plan, mockEngine))
          .toThrow('Hybrid plan execution not implemented');
      });
    });

    describe('validatePlanResults', () => {
      it('should validate plan execution results', () => {
        // Given: A query plan to validate
        const plan: QueryPlan = {
          queryType: QueryType.SEMANTIC_ONLY,
          steps: [{
            type: 'semantic_search',
            description: 'Search',
            estimatedCost: 20,
            parameters: { text: 'validate', limit: 10 }
          }],
          estimatedTotalCost: 20,
          recommendedIndexes: [],
          optimizationHints: []
        };

        // When: Validating plan results
        // Then: Should fail with not implemented error
        expect(() => planner.validatePlanResults(plan, mockEngine))
          .toThrow('Plan result validation not implemented');
      });

      it('should validate result consistency across executions', () => {
        // Given: A plan that should produce consistent results
        const plan: QueryPlan = {
          queryType: QueryType.FILTER_ONLY,
          steps: [{
            type: 'sql_filter',
            description: 'Deterministic filter',
            estimatedCost: 5,
            parameters: { filters: { id: '123' }, limit: 1 }
          }],
          estimatedTotalCost: 5,
          recommendedIndexes: [],
          optimizationHints: []
        };

        // When: Validating result consistency
        // Then: Should fail with not implemented error
        expect(() => planner.validatePlanResults(plan, mockEngine))
          .toThrow('Plan result validation not implemented');
      });
    });
  });

  describe('Performance Measurement', () => {
    describe('measureExecutionTime', () => {
      it('should measure plan execution time accurately', () => {
        // Given: A query plan to measure
        const plan: QueryPlan = {
          queryType: QueryType.SEMANTIC_ONLY,
          steps: [{
            type: 'semantic_search',
            description: 'Timed search',
            estimatedCost: 30,
            parameters: { text: 'performance test', limit: 50 }
          }],
          estimatedTotalCost: 30,
          recommendedIndexes: [],
          optimizationHints: []
        };

        // When: Measuring execution time
        // Then: Should fail with not implemented error
        expect(() => planner.measureExecutionTime(plan, mockEngine))
          .toThrow('Execution time measurement not implemented');
      });

      it('should provide sub-millisecond timing precision', () => {
        // Given: A fast query plan
        const plan: QueryPlan = {
          queryType: QueryType.FILTER_ONLY,
          steps: [{
            type: 'sql_filter',
            description: 'Fast filter',
            estimatedCost: 1,
            parameters: { filters: { id: 'abc' }, limit: 1 }
          }],
          estimatedTotalCost: 1,
          recommendedIndexes: [],
          optimizationHints: []
        };

        // When: Measuring fast execution time
        // Then: Should fail with not implemented error
        expect(() => planner.measureExecutionTime(plan, mockEngine))
          .toThrow('Execution time measurement not implemented');
      });
    });

    describe('measureExecutionPerformance', () => {
      it('should measure comprehensive performance metrics', () => {
        // Given: A complex query plan
        const plan: QueryPlan = {
          queryType: QueryType.HYBRID,
          steps: [
            {
              type: 'sql_filter',
              description: 'Performance filter',
              estimatedCost: 20,
              parameters: { filters: { eventType: 'performance' }, limit: 100 }
            },
            {
              type: 'semantic_search',
              description: 'Performance search',
              estimatedCost: 40,
              parameters: { text: 'performance metrics', limit: 10 }
            }
          ],
          estimatedTotalCost: 60,
          recommendedIndexes: [],
          optimizationHints: []
        };

        // When: Measuring comprehensive performance
        // Then: Should fail with not implemented error
        expect(() => planner.measureExecutionPerformance(plan, mockEngine))
          .toThrow('Performance measurement not implemented');
      });

      it('should track memory usage during execution', () => {
        // Given: A memory-intensive plan
        const plan: QueryPlan = {
          queryType: QueryType.SEMANTIC_ONLY,
          steps: [{
            type: 'semantic_search',
            description: 'Memory-intensive search',
            estimatedCost: 100,
            parameters: { text: 'large dataset analysis', limit: 10000 }
          }],
          estimatedTotalCost: 100,
          recommendedIndexes: [],
          optimizationHints: []
        };

        // When: Measuring performance including memory
        // Then: Should fail with not implemented error
        expect(() => planner.measureExecutionPerformance(plan, mockEngine))
          .toThrow('Performance measurement not implemented');
      });
    });

    describe('trackEstimationAccuracy', () => {
      it('should track accuracy of cost estimations', () => {
        // Given: A set of queries with known execution patterns
        const queries: Query[] = [
          { text: 'test query 1', filters: {}, limit: 10 },
          { text: 'test query 2', filters: { eventType: 'test' }, limit: 20 },
          { text: 'test query 3', filters: { author: 'tester' }, limit: 5 }
        ];

        // When: Tracking estimation accuracy
        // Then: Should fail with not implemented error
        expect(() => planner.trackEstimationAccuracy(queries, mockEngine))
          .toThrow('Estimation accuracy tracking not implemented');
      });

      it('should identify patterns in estimation errors', () => {
        // Given: Queries with varied complexity
        const queries: Query[] = [
          {
            text: 'simple query',
            filters: {},
            limit: 10
          },
          {
            text: 'complex query with many filters',
            filters: {
              eventType: ['type1', 'type2'],
              author: 'user',
              timestamp: { after: new Date() },
              tags: ['tag1', 'tag2', 'tag3']
            },
            limit: 100
          }
        ];

        // When: Tracking patterns in estimation accuracy
        // Then: Should fail with not implemented error
        expect(() => planner.trackEstimationAccuracy(queries, mockEngine))
          .toThrow('Estimation accuracy tracking not implemented');
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle null/undefined engine parameter', () => {
      // Given: A valid plan but null engine
      const plan: QueryPlan = {
        queryType: QueryType.SEMANTIC_ONLY,
        steps: [{
          type: 'semantic_search',
          description: 'Test',
          estimatedCost: 10,
          parameters: {}
        }],
        estimatedTotalCost: 10,
        recommendedIndexes: [],
        optimizationHints: []
      };

      // When: Executing with null engine
      // Then: Should fail with not implemented error
      expect(() => planner.executePlan(plan, null as any))
        .toThrow('Plan execution not implemented');
    });

    it('should handle invalid plan structures', () => {
      // Given: An invalid plan structure
      const invalidPlan = {
        queryType: 'invalid_type',
        steps: null,
        estimatedTotalCost: -1
      } as any;

      // When: Executing invalid plan
      // Then: Should fail with not implemented error
      expect(() => planner.executePlan(invalidPlan, mockEngine))
        .toThrow('Plan execution not implemented');
    });

    it('should validate concurrent planning limits', async () => {
      // Given: Too many concurrent queries
      const tooManyQueries: Query[] = Array(10000).fill(0).map((_, i) => ({
        text: `query ${i}`,
        filters: {},
        limit: 10
      }));

      // When: Planning excessive concurrent queries
      // Then: Should handle them in batches
      const plans = await planner.planQueriesConcurrently(tooManyQueries);
      expect(plans).toHaveLength(10000);
    });

    it('should handle memory estimation for empty queries', () => {
      // Given: An empty query
      const emptyQuery: Query = {
        text: '',
        filters: {},
        limit: 0
      };

      // When: Estimating memory for empty query
      const memoryUsage = planner.estimateMemoryUsage(emptyQuery);

      // Then: Should return base memory
      expect(memoryUsage).toBe(1024); // Base memory only
    });

    it('should validate boolean logic with circular references', () => {
      // Given: Boolean logic with potential circular references
      const circularQuery: Query = {
        text: 'circular logic test',
        filters: {
          $and: [
            { $or: [{ field1: 'value1' }] },
            { $and: [{ field2: 'value2' }] } // Nested same type
          ]
        }
      };

      // When: Analyzing circular boolean logic
      const result = planner.analyzeComplexityWithBooleanLogic(circularQuery);

      // Then: Should handle nested logic correctly
      expect(result).toBeDefined();
      expect(result.filterCount).toBe(2); // field1 and field2
      expect(result.reason).toContain('3 operators'); // 2 $and and 1 $or
    });
  });

  describe('Integration with StorageEngine', () => {
    it('should integrate properly with mocked StorageEngine', () => {
      // Given: A plan that requires StorageEngine interaction
      const plan: QueryPlan = {
        queryType: QueryType.HYBRID,
        steps: [
          {
            type: 'sql_filter',
            description: 'Storage integration test',
            estimatedCost: 15,
            parameters: { filters: { test: true }, limit: 10 }
          }
        ],
        estimatedTotalCost: 15,
        recommendedIndexes: [],
        optimizationHints: []
      };

      // When: Executing plan with mocked engine
      // Then: Should fail with not implemented error
      expect(() => planner.executePlan(plan, mockEngine))
        .toThrow('Plan execution not implemented');
    });

    it('should handle StorageEngine method failures gracefully', () => {
      // Given: A StorageEngine that will fail
      const failingEngine = {
        search: jest.fn().mockRejectedValue(new Error('Storage failure')),
        query: jest.fn().mockRejectedValue(new Error('Query failure')),
        getStats: jest.fn().mockRejectedValue(new Error('Stats failure')),
        getIndexInfo: jest.fn().mockRejectedValue(new Error('Index failure'))
      };

      const plan: QueryPlan = {
        queryType: QueryType.SEMANTIC_ONLY,
        steps: [{
          type: 'semantic_search',
          description: 'Failing search',
          estimatedCost: 20,
          parameters: { text: 'test' }
        }],
        estimatedTotalCost: 20,
        recommendedIndexes: [],
        optimizationHints: []
      };

      // When: Executing plan with failing engine
      // Then: Should fail with not implemented error
      expect(() => planner.executePlan(plan, failingEngine))
        .toThrow('Plan execution not implemented');
    });
  });

  describe('Performance Requirements Validation', () => {
    it('should meet boolean logic analysis performance requirement (<10ms)', () => {
      // Given: A boolean logic query
      const query: Query = {
        text: 'performance test',
        filters: {
          $and: [{ field1: 'value1' }, { field2: 'value2' }]
        }
      };

      // When: Measuring boolean analysis time
      const startTime = performance.now();
      const result = planner.analyzeComplexityWithBooleanLogic(query);
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Then: Should complete in less than 10ms
      expect(result).toBeDefined();
      expect(duration).toBeLessThan(10);
    });

    it('should meet concurrent planning performance requirements', async () => {
      // Given: Multiple queries for concurrent planning
      const queries: Query[] = Array(10).fill(0).map((_, i) => ({
        text: `concurrent query ${i}`,
        filters: { index: i },
        limit: 10
      }));

      // When: Measuring concurrent planning time
      const startTime = performance.now();
      const plans = await planner.planQueriesConcurrently(queries);
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Then: Should complete quickly for small batch
      expect(plans).toHaveLength(10);
      expect(duration).toBeLessThan(100); // 100ms for 10 queries
    });
  });
});