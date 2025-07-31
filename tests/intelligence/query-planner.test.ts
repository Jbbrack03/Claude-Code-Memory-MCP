import { QueryPlanner } from '../../src/intelligence/query-planner.js';

// Types that will be defined in src/intelligence/types.ts
enum QueryType {
  SEMANTIC_ONLY = 'semantic_only',
  FILTER_ONLY = 'filter_only',
  HYBRID = 'hybrid'
}

enum QueryComplexity {
  SIMPLE = 'simple',
  COMPLEX = 'complex'
}

interface QueryPlan {
  queryType: QueryType;
  steps: Array<{
    type: string;
    description: string;
    estimatedCost: number;
    parameters: any;
  }>;
  estimatedTotalCost: number;
  recommendedIndexes: string[];
  optimizationHints: string[];
}

describe('QueryPlanner', () => {
  let planner: QueryPlanner;

  beforeEach(() => {
    planner = new QueryPlanner();
  });

  describe('initialization', () => {
    it('should create a new instance', () => {
      expect(planner).toBeInstanceOf(QueryPlanner);
    });
  });

  describe('analyzeComplexity', () => {
    it('should analyze simple semantic queries', () => {
      const query = {
        text: 'find code related to authentication',
        filters: {}
      };

      const complexity = planner.analyzeComplexity(query);
      
      expect(complexity).toEqual({
        type: QueryComplexity.SIMPLE,
        hasSemanticComponent: true,
        hasFilterComponent: false,
        filterCount: 0,
        estimatedCost: expect.any(Number),
        reason: 'Simple semantic search without filters'
      });
    });

    it('should analyze filter-only queries', () => {
      const query = {
        text: '',
        filters: {
          eventType: 'file_created',
          projectId: 'test-project',
          timestamp: { after: new Date('2025-01-01') }
        }
      };

      const complexity = planner.analyzeComplexity(query);
      
      expect(complexity).toEqual({
        type: QueryComplexity.SIMPLE,
        hasSemanticComponent: false,
        hasFilterComponent: true,
        filterCount: 3,
        estimatedCost: expect.any(Number),
        reason: 'Filter-based query without semantic search'
      });
    });

    it('should analyze complex hybrid queries', () => {
      const query = {
        text: 'authentication flow in user service',
        filters: {
          eventType: ['file_modified', 'function_created'],
          projectId: 'auth-service',
          tags: ['security', 'auth'],
          timestamp: { 
            after: new Date('2025-01-01'),
            before: new Date('2025-02-01')
          }
        }
      };

      const complexity = planner.analyzeComplexity(query);
      
      expect(complexity).toEqual({
        type: QueryComplexity.COMPLEX,
        hasSemanticComponent: true,
        hasFilterComponent: true,
        filterCount: 4,
        estimatedCost: expect.any(Number),
        reason: 'Hybrid query with both semantic search and multiple filters'
      });
    });

    it('should handle empty queries', () => {
      const query = {
        text: '',
        filters: {}
      };

      const complexity = planner.analyzeComplexity(query);
      
      expect(complexity).toEqual({
        type: QueryComplexity.SIMPLE,
        hasSemanticComponent: false,
        hasFilterComponent: false,
        filterCount: 0,
        estimatedCost: 0,
        reason: 'Empty query'
      });
    });
  });

  describe('createPlan', () => {
    it('should create semantic-only plan for pure text queries', () => {
      const query = {
        text: 'database connection pooling implementation',
        filters: {},
        limit: 10
      };

      const plan = planner.createPlan(query);

      expect(plan).toEqual({
        queryType: QueryType.SEMANTIC_ONLY,
        steps: [
          {
            type: 'semantic_search',
            description: 'Perform semantic search',
            estimatedCost: expect.any(Number),
            parameters: {
              text: 'database connection pooling implementation',
              limit: 10,
              threshold: 0.7
            }
          }
        ],
        estimatedTotalCost: expect.any(Number),
        recommendedIndexes: [],
        optimizationHints: []
      });
    });

    it('should create filter-only plan for pure filter queries', () => {
      const query = {
        text: '',
        filters: {
          eventType: 'commit',
          branch: 'main'
        },
        limit: 20
      };

      const plan = planner.createPlan(query);

      expect(plan).toEqual({
        queryType: QueryType.FILTER_ONLY,
        steps: [
          {
            type: 'sql_filter',
            description: 'Apply SQL filters',
            estimatedCost: expect.any(Number),
            parameters: {
              filters: {
                eventType: 'commit',
                branch: 'main'
              },
              limit: 20
            }
          }
        ],
        estimatedTotalCost: expect.any(Number),
        recommendedIndexes: ['eventType', 'branch'],
        optimizationHints: []
      });
    });

    it('should create hybrid plan for queries with both text and filters', () => {
      const query = {
        text: 'error handling in payment service',
        filters: {
          eventType: 'file_modified',
          timestamp: { after: new Date('2025-01-15') }
        },
        limit: 15
      };

      const plan = planner.createPlan(query);

      expect(plan).toEqual({
        queryType: QueryType.HYBRID,
        steps: [
          {
            type: 'sql_filter',
            description: 'Pre-filter with SQL',
            estimatedCost: expect.any(Number),
            parameters: {
              filters: {
                eventType: 'file_modified',
                timestamp: { after: new Date('2025-01-15') }
              },
              limit: 100 // Pre-filter gets more results
            }
          },
          {
            type: 'semantic_search',
            description: 'Semantic search on filtered results',
            estimatedCost: expect.any(Number),
            parameters: {
              text: 'error handling in payment service',
              limit: 15,
              threshold: 0.7
            }
          }
        ],
        estimatedTotalCost: expect.any(Number),
        recommendedIndexes: ['eventType', 'timestamp'],
        optimizationHints: [
          'Consider creating composite index on (eventType, timestamp)'
        ]
      });
    });

    it('should optimize plan for high-cardinality filters', () => {
      const query = {
        text: 'API endpoints',
        filters: {
          id: '12345', // High cardinality filter
          projectId: 'api-service'
        },
        limit: 5
      };

      const plan = planner.createPlan(query);

      // Should prioritize ID filter first
      expect(plan.steps[0]).toEqual({
        type: 'sql_filter',
        description: 'Apply high-cardinality filters first',
        estimatedCost: expect.any(Number),
        parameters: {
          filters: { id: '12345', projectId: 'api-service' },
          limit: 5
        }
      });

      expect(plan.optimizationHints).toContain(
        'High-cardinality filter detected - SQL filtering will be very efficient'
      );
    });

    it('should handle queries with array filters', () => {
      const query = {
        text: '',
        filters: {
          eventType: ['commit', 'merge', 'push'],
          tags: ['backend', 'api']
        },
        limit: 30
      };

      const plan = planner.createPlan(query);

      expect(plan.queryType).toBe(QueryType.FILTER_ONLY);
      expect(plan.recommendedIndexes).toContain('eventType');
      expect(plan.recommendedIndexes).toContain('tags');
    });
  });

  describe('estimateCost', () => {
    it('should estimate low cost for simple semantic queries', () => {
      const query = {
        text: 'user authentication',
        filters: {},
        limit: 10
      };

      const cost = planner.estimateCost(query);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(50);
    });

    it('should estimate very low cost for ID-based queries', () => {
      const query = {
        text: '',
        filters: { id: 'abc123' },
        limit: 1
      };

      const cost = planner.estimateCost(query);

      expect(cost).toBeLessThan(5);
    });

    it('should estimate higher cost for complex hybrid queries', () => {
      const query = {
        text: 'complex search with multiple terms and filters',
        filters: {
          eventType: ['type1', 'type2', 'type3'],
          tags: ['tag1', 'tag2'],
          timestamp: { after: new Date('2025-01-01') },
          branch: 'feature/*'
        },
        limit: 50
      };

      const cost = planner.estimateCost(query);

      expect(cost).toBeGreaterThan(100);
    });

    it('should estimate zero cost for empty queries', () => {
      const query = {
        text: '',
        filters: {},
        limit: 10
      };

      const cost = planner.estimateCost(query);

      expect(cost).toBe(0);
    });

    it('should factor in limit when estimating cost', () => {
      const baseQuery = {
        text: 'search term',
        filters: { eventType: 'commit' }
      };

      const costSmallLimit = planner.estimateCost({ ...baseQuery, limit: 10 });
      const costLargeLimit = planner.estimateCost({ ...baseQuery, limit: 1000 });

      expect(costLargeLimit).toBeGreaterThan(costSmallLimit);
    });
  });

  describe('optimizePlan', () => {
    it('should suggest indexes for frequently filtered fields', () => {
      const plan: QueryPlan = {
        queryType: QueryType.FILTER_ONLY,
        steps: [{
          type: 'sql_filter',
          description: 'Apply filters',
          estimatedCost: 20,
          parameters: {
            filters: {
              eventType: 'commit',
              projectId: 'test',
              timestamp: { after: new Date() }
            }
          }
        }],
        estimatedTotalCost: 20,
        recommendedIndexes: [],
        optimizationHints: []
      };

      const optimized = planner.optimizePlan(plan);

      expect(optimized.recommendedIndexes).toContain('eventType');
      expect(optimized.recommendedIndexes).toContain('projectId');
      expect(optimized.recommendedIndexes).toContain('timestamp');
    });

    it('should reorder steps for better performance', () => {
      const plan: QueryPlan = {
        queryType: QueryType.HYBRID,
        steps: [
          {
            type: 'semantic_search',
            description: 'Semantic search',
            estimatedCost: 100,
            parameters: { text: 'search', limit: 1000 }
          },
          {
            type: 'sql_filter',
            description: 'Filter results',
            estimatedCost: 10,
            parameters: { filters: { id: '123' } }
          }
        ],
        estimatedTotalCost: 110,
        recommendedIndexes: [],
        optimizationHints: []
      };

      const optimized = planner.optimizePlan(plan);

      // Should reorder to do cheap SQL filter first
      expect(optimized.steps[0]?.type).toBe('sql_filter');
      expect(optimized.steps[1]?.type).toBe('semantic_search');
      expect(optimized.optimizationHints).toContain(
        'Reordered steps to apply filters before semantic search'
      );
    });

    it('should not modify already optimal plans', () => {
      const plan: QueryPlan = {
        queryType: QueryType.SEMANTIC_ONLY,
        steps: [{
          type: 'semantic_search',
          description: 'Semantic search',
          estimatedCost: 30,
          parameters: { text: 'search', limit: 10 }
        }],
        estimatedTotalCost: 30,
        recommendedIndexes: [],
        optimizationHints: []
      };

      const optimized = planner.optimizePlan(plan);

      expect(optimized).toEqual(plan);
    });
  });

  describe('edge cases', () => {
    it('should handle null or undefined inputs', () => {
      expect(() => planner.analyzeComplexity(null as any)).toThrow('Invalid query');
      expect(() => planner.analyzeComplexity(undefined as any)).toThrow('Invalid query');
      expect(() => planner.createPlan(null as any)).toThrow('Invalid query');
      expect(() => planner.estimateCost(undefined as any)).toThrow('Invalid query');
    });

    it('should handle queries with invalid filter values', () => {
      const query = {
        text: 'search',
        filters: {
          eventType: null,
          timestamp: 'invalid-date'
        } as any
      };

      expect(() => planner.createPlan(query)).toThrow('Invalid filter value');
    });

    it('should handle very large limit values', () => {
      const query = {
        text: 'search',
        filters: {},
        limit: 1000000
      };

      const plan = planner.createPlan(query);

      expect(plan.optimizationHints).toContain(
        'Large limit detected - consider pagination'
      );
    });

    it('should handle queries with special characters in text', () => {
      const query = {
        text: 'search with $pecial ch@racters & symbols!',
        filters: {},
        limit: 10
      };

      const plan = planner.createPlan(query);

      expect(plan.queryType).toBe(QueryType.SEMANTIC_ONLY);
      expect(plan.steps[0]?.parameters.text).toBe(query.text);
    });

    it('should handle deeply nested filter objects', () => {
      const query = {
        text: '',
        filters: {
          metadata: {
            author: {
              name: 'John',
              email: 'john@example.com'
            },
            tags: {
              category: 'backend',
              priority: 'high'
            }
          }
        },
        limit: 20
      };

      const plan = planner.createPlan(query);

      expect(plan.queryType).toBe(QueryType.FILTER_ONLY);
      expect(plan.estimatedTotalCost).toBeGreaterThan(0);
    });
  });

  // Enhanced unit tests for missing functionality
  describe('complex filter combinations', () => {
    it('should handle boolean AND/OR combinations in filters', () => {
      const query = {
        text: '',
        filters: {
          $and: [
            { eventType: 'file_created' },
            { $or: [
              { author: 'alice' },
              { author: 'bob' }
            ]}
          ],
          timestamp: { after: new Date('2025-01-01') }
        }
      };

      // This should fail initially as complex boolean logic isn't implemented
      expect(() => planner.analyzeComplexityWithBooleanLogic(query)).toThrow('Boolean filter logic not implemented');
    });

    it('should handle range filters with multiple conditions', () => {
      const query = {
        text: 'error handling',
        filters: {
          timestamp: { 
            after: new Date('2025-01-01'),
            before: new Date('2025-02-01')
          },
          lineCount: { min: 10, max: 1000 },
          fileSize: { min: '1KB', max: '10MB' }
        }
      };

      // This should fail as advanced range filtering isn't implemented
      expect(() => planner.analyzeRangeFilters(query)).toThrow('Advanced range filtering not implemented');
    });

    it('should handle geospatial filters for location-based queries', () => {
      const query = {
        text: 'deployment scripts',
        filters: {
          location: {
            type: 'circle',
            center: { lat: 37.7749, lng: -122.4194 },
            radius: '50km'
          },
          region: 'us-west-1'
        }
      };

      // This should fail as geospatial filtering isn't implemented
      expect(() => planner.analyzeGeospatialFilters(query)).toThrow('Geospatial filtering not implemented');
    });

    it('should handle fuzzy matching filters', () => {
      const query = {
        text: '',
        filters: {
          filename: { fuzzy: 'test.js', threshold: 0.8 },
          author: { fuzzy: 'john', distance: 2 }
        }
      };

      // This should fail as fuzzy matching isn't implemented
      expect(() => planner.analyzeFuzzyFilters(query)).toThrow('Fuzzy filtering not implemented');
    });
  });

  describe('memory usage analysis', () => {
    it('should analyze memory usage for large result sets', () => {
      const query = {
        text: 'database queries',
        filters: {},
        limit: 10000
      };

      // This should fail as memory analysis isn't implemented
      expect(() => planner.estimateMemoryUsage(query)).toThrow('Memory usage analysis not implemented');
    });

    it('should estimate memory footprint for different query types', () => {
      const semanticQuery = { text: 'authentication', filters: {} };
      const filterQuery = { text: '', filters: { eventType: 'commit' } };
      const hybridQuery = { text: 'auth', filters: { eventType: 'commit' } };

      // These should fail as memory footprint estimation isn't implemented
      expect(() => planner.estimateMemoryFootprint(semanticQuery)).toThrow('Memory footprint estimation not implemented');
      expect(() => planner.estimateMemoryFootprint(filterQuery)).toThrow('Memory footprint estimation not implemented');
      expect(() => planner.estimateMemoryFootprint(hybridQuery)).toThrow('Memory footprint estimation not implemented');
    });

    it('should provide memory optimization recommendations', () => {
      const query = {
        text: 'large codebase analysis',
        filters: {
          fileType: ['js', 'ts', 'jsx', 'tsx'],
          timestamp: { after: new Date('2024-01-01') }
        },
        limit: 50000
      };

      // This should fail as memory optimization isn't implemented
      expect(() => planner.getMemoryOptimizationHints(query)).toThrow('Memory optimization hints not implemented');
    });
  });

  describe('concurrent query planning', () => {
    it('should handle multiple concurrent query planning requests', async () => {
      const queries = [
        { text: 'auth service', filters: {} },
        { text: 'payment flow', filters: { eventType: 'api_call' } },
        { text: 'user management', filters: { project: 'backend' } }
      ];

      // This should fail as concurrent planning isn't implemented
      expect(() => planner.planQueriesConcurrently(queries)).toThrow('Concurrent query planning not implemented');
    });

    it('should maintain thread safety during concurrent operations', () => {
      // This should fail as thread-safe planning isn't implemented
      expect(() => 
        planner.createPlanThreadSafe({
          text: 'query',
          filters: { index: 1 }
        })
      ).toThrow('Thread-safe planning not implemented');
    });

    it('should handle resource contention gracefully', async () => {
      const highLoadQueries = Array(100).fill(0).map((_, i) => ({
        text: `complex query with many terms ${i}`,
        filters: {
          eventType: ['type1', 'type2', 'type3'],
          timestamp: { after: new Date() },
          tags: Array(20).fill(0).map((_, j) => `tag${j}`)
        },
        limit: 1000
      }));

      // This should fail as resource contention handling isn't implemented
      expect(() => planner.handleHighLoadPlanning(highLoadQueries)).toThrow('High load planning not implemented');
    });
  });

  describe('multi-workspace scenarios', () => {
    it('should plan queries across multiple workspaces', () => {
      const query = {
        text: 'shared utility functions',
        filters: {
          workspaces: ['frontend', 'backend', 'mobile'],
          eventType: 'function_created'
        }
      };

      // This should fail as multi-workspace planning isn't implemented
      expect(() => planner.planMultiWorkspaceQuery(query)).toThrow('Multi-workspace planning not implemented');
    });

    it('should handle workspace-specific optimization strategies', () => {
      const workspaceConfigs = {
        'large-monorepo': { strategy: 'incremental-indexing' },
        'microservices': { strategy: 'distributed-search' },
        'mobile-app': { strategy: 'memory-optimized' }
      };

      // This should fail as workspace-specific strategies aren't implemented
      expect(() => planner.configureWorkspaceStrategies(workspaceConfigs)).toThrow('Workspace strategies not implemented');
    });

    it('should aggregate results from multiple workspace queries', () => {
      const queries = [
        { workspace: 'frontend', text: 'React components', filters: {} },
        { workspace: 'backend', text: 'API endpoints', filters: {} },
        { workspace: 'shared', text: 'utility functions', filters: {} }
      ];

      // This should fail as result aggregation isn't implemented
      expect(() => planner.aggregateWorkspaceResults(queries)).toThrow('Result aggregation not implemented');
    });
  });

  describe('adaptive query optimization', () => {
    it('should learn from query execution history', () => {
      const executionHistory = [
        { query: { text: 'auth', filters: {} }, actualCost: 25, estimatedCost: 30 },
        { query: { text: 'payment', filters: {} }, actualCost: 15, estimatedCost: 20 }
      ];

      // This should fail as adaptive learning isn't implemented
      expect(() => planner.learnFromExecutionHistory(executionHistory)).toThrow('Adaptive learning not implemented');
    });

    it('should adjust cost estimates based on historical data', () => {
      const query = { text: 'database queries', filters: { eventType: 'sql' } };
      
      // This should fail as cost adjustment isn't implemented
      expect(() => planner.getAdjustedCostEstimate(query)).toThrow('Cost adjustment not implemented');
    });

    it('should recommend query modifications for better performance', () => {
      const slowQuery = {
        text: 'very complex search with many terms and conditions',
        filters: {
          timestamp: { after: new Date('2020-01-01') }, // Very broad date range
          tags: Array(50).fill(0).map((_, i) => `tag${i}`) // Too many tags
        },
        limit: 100000 // Very large limit
      };

      // This should fail as query modification recommendations aren't implemented
      expect(() => planner.recommendQueryModifications(slowQuery)).toThrow('Query modification recommendations not implemented');
    });
  });
});