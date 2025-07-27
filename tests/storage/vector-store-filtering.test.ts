import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { VectorStore } from "../../src/storage/vector-store.js";

describe('VectorStore - Advanced Filtering', () => {
  let store: VectorStore;

  beforeEach(async () => {
    store = new VectorStore({ dimension: 3 });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) {
      await store.close();
    }
  });

  describe('complex metadata filtering', () => {
    beforeEach(async () => {
      // Setup diverse test data
      const testData = [
        { vector: [1, 0, 0], metadata: { project: 'A', type: 'commit', priority: 1, timestamp: 1000 } },
        { vector: [0, 1, 0], metadata: { project: 'A', type: 'file', priority: 2, timestamp: 2000 } },
        { vector: [0, 0, 1], metadata: { project: 'B', type: 'commit', priority: 1, timestamp: 3000 } },
        { vector: [1, 1, 0], metadata: { project: 'B', type: 'test', priority: 3, timestamp: 4000 } },
        { vector: [0, 1, 1], metadata: { project: 'C', type: 'file', priority: 2, timestamp: 5000 } },
        { vector: [1, 0, 1], metadata: { project: 'C', type: 'commit', priority: 1, timestamp: 6000 } }
      ];

      await store.storeBatch(testData);
    });

    it('should support range queries on numeric fields', async () => {
      // Given: Query vector
      const queryVector = [0.5, 0.5, 0];

      // When: Searching with range filter
      const results = await store.search(queryVector, {
        k: 10,
        filter: {
          timestamp: { $gte: 2000, $lt: 5000 } // Feature not implemented yet
        }
      });

      // Then: Should only return vectors within timestamp range
      expect(results.length).toBe(3);
      expect(results.every(r => {
        const timestamp = r.metadata.timestamp;
        return typeof timestamp === 'number' && timestamp >= 2000 && timestamp < 5000;
      })).toBe(true);
    });

    it('should support IN queries for multiple values', async () => {
      // When: Searching with IN filter
      const results = await store.search([1, 0, 0], {
        k: 10,
        filter: {
          project: { $in: ['A', 'C'] as any }, // Feature not implemented yet
          type: 'commit'
        }
      });

      // Then: Should return commits from projects A or C
      expect(results.length).toBe(2);
      expect(results.every(r => 
        ['A', 'C'].includes(r.metadata.project as string) && r.metadata.type === 'commit'
      )).toBe(true);
    });

    it('should support NOT queries for exclusion', async () => {
      // When: Searching with NOT filter
      const results = await store.search([0, 1, 0], {
        k: 10,
        filter: {
          type: { $ne: 'test' }, // Feature not implemented yet
          priority: { $ne: 3 }
        }
      });

      // Then: Should exclude test type and priority 3
      expect(results.every(r => r.metadata.type !== 'test')).toBe(true);
      expect(results.every(r => r.metadata.priority !== 3)).toBe(true);
    });

    it('should support OR conditions', async () => {
      // When: Searching with OR conditions
      const results = await store.search([0.5, 0.5, 0.5], {
        k: 10,
        filter: {
          $or: [ // Feature not implemented yet
            { project: 'A', type: 'commit' },
            { project: 'B', priority: 3 }
          ]
        }
      });

      // Then: Should return vectors matching either condition
      expect(results.length).toBe(2);
      const matches = results.every(r => 
        (r.metadata.project === 'A' && r.metadata.type === 'commit') ||
        (r.metadata.project === 'B' && r.metadata.priority === 3)
      );
      expect(matches).toBe(true);
    });

    it('should support AND conditions with nesting', async () => {
      // When: Complex nested query
      const results = await store.search([1, 1, 1], {
        k: 10,
        filter: {
          $and: [ // Feature not implemented yet
            { project: { $in: ['A', 'B'] as any } },
            {
              $or: [
                { type: 'commit', priority: 1 },
                { type: 'file', priority: 2 }
              ]
            }
          ]
        }
      });

      // Then: Should apply complex logic correctly
      expect(results.length).toBe(3);
      const correctFiltering = results.every(r => {
        const inProject = ['A', 'B'].includes(r.metadata.project as string);
        const matchesTypeAndPriority = 
          (r.metadata.type === 'commit' && r.metadata.priority === 1) ||
          (r.metadata.type === 'file' && r.metadata.priority === 2);
        return inProject && matchesTypeAndPriority;
      });
      expect(correctFiltering).toBe(true);
    });

    it('should support regex pattern matching', async () => {
      // Given: Vectors with string patterns
      await store.storeBatch([
        { vector: [1, 0, 0], metadata: { filename: 'test_file_001.js' } },
        { vector: [0, 1, 0], metadata: { filename: 'test_file_002.ts' } },
        { vector: [0, 0, 1], metadata: { filename: 'prod_config.json' } }
      ]);

      // When: Searching with regex filter
      const results = await store.search([1, 0, 0], {
        k: 10,
        filter: {
          filename: { $regex: '^test_.*\\.js$' } as any // Feature not implemented yet
        }
      });

      // Then: Should match regex pattern
      expect(results.length).toBe(1);
      expect(results[0]!.metadata.filename).toBe('test_file_001.js');
    });

    it('should support exists/not exists queries', async () => {
      // Given: Some vectors with optional fields
      await store.storeBatch([
        { vector: [1, 0, 0], metadata: { testGroup: 'exists-test', required: true, optional: 'value' } },
        { vector: [0, 1, 0], metadata: { testGroup: 'exists-test', required: true } },
        { vector: [0, 0, 1], metadata: { testGroup: 'exists-test', required: true, optional: null } }
      ]);

      // When: Searching for vectors with optional field
      const withOptional = await store.search([1, 0, 0], {
        k: 10,
        filter: {
          testGroup: 'exists-test',
          optional: { $exists: true } as any // Feature not implemented yet
        }
      });

      const withoutOptional = await store.search([1, 0, 0], {
        k: 10,
        filter: {
          testGroup: 'exists-test',
          optional: { $exists: false } as any
        }
      });

      // Then: Should correctly identify field existence
      expect(withOptional.length).toBe(2); // Including null value
      expect(withoutOptional.length).toBe(1);
    });
  });

  describe('filter performance optimization', () => {
    it('should use metadata indexes for faster filtering', async () => {
      // Given: Store with metadata indexing
      const indexedStore = new VectorStore({ 
        dimension: 3,
        metadataIndexes: ['project', 'type', 'timestamp'] // Feature not implemented yet
      });
      await indexedStore.initialize();

      // Insert large dataset
      const vectors = [];
      for (let i = 0; i < 10000; i++) {
        vectors.push({
          vector: [Math.random(), Math.random(), Math.random()],
          metadata: {
            project: `proj_${i % 10}`,
            type: ['commit', 'file', 'test'][i % 3]!,
            timestamp: Date.now() + i,
            data: `data_${i}`
          }
        });
      }
      await indexedStore.storeBatch(vectors);

      // When: Filtering on indexed field
      const startTime = Date.now();
      const results = await indexedStore.search([1, 0, 0], {
        k: 100,
        filter: {
          project: 'proj_5',
          type: 'commit'
        }
      });
      const filterTime = Date.now() - startTime;

      // Then: Should complete quickly with indexes
      expect(filterTime).toBeLessThan(50); // Much faster than linear scan
      expect(results.every(r => 
        r.metadata.project === 'proj_5' && r.metadata.type === 'commit'
      )).toBe(true);

      await indexedStore.close();
    });

    it('should optimize filter order for better performance', async () => {
      // Given: Complex filter with varying selectivity
      const largeDataset = Array(1000).fill(null).map((_, i) => ({
        vector: [Math.random(), Math.random(), Math.random()],
        metadata: {
          rare: i === 42 ? 'special' : 'common',
          common: i % 2 === 0 ? 'even' : 'odd',
          veryCommon: 'same'
        }
      }));
      await store.storeBatch(largeDataset);

      // When: Searching with multi-condition filter
      const results = await store.search([1, 0, 0], {
        k: 10,
        filter: {
          veryCommon: 'same',    // Low selectivity
          common: 'even',        // Medium selectivity  
          rare: 'special'        // High selectivity
        },
        optimizeFilter: true // Feature not implemented yet
      });

      // Then: Should find the single matching vector efficiently
      expect(results.length).toBe(1);
      expect(results[0]!.metadata.rare).toBe('special');
      
      // Store should have reordered filters internally for efficiency
      // (checking rare first, then common, then veryCommon)
    });
  });

  describe('dynamic filtering', () => {
    it('should support function-based filters', async () => {
      // Given: Vectors with complex metadata
      await store.storeBatch([
        { vector: [1, 0, 0], metadata: { score: 85, category: 'A' } },
        { vector: [0, 1, 0], metadata: { score: 92, category: 'B' } },
        { vector: [0, 0, 1], metadata: { score: 78, category: 'A' } },
        { vector: [1, 1, 0], metadata: { score: 88, category: 'B' } }
      ]);

      // When: Using function filter
      const results = await store.search([1, 0, 0], {
        k: 10,
        filterFn: (metadata) => { // Feature not implemented yet
          return (metadata.score as number) > 80 && metadata.category === 'B';
        }
      });

      // Then: Should apply custom filter logic
      expect(results.length).toBe(2);
      expect(results.every(r => 
        (r.metadata.score as number) > 80 && r.metadata.category === 'B'
      )).toBe(true);
    });

    it('should support computed fields in filters', async () => {
      // Given: Vectors with timestamp data
      const now = Date.now();
      await store.storeBatch([
        { vector: [1, 0, 0], metadata: { created: now - 3600000, type: 'old' } },
        { vector: [0, 1, 0], metadata: { created: now - 1800000, type: 'recent' } },
        { vector: [0, 0, 1], metadata: { created: now - 300000, type: 'new' } }
      ]);

      // When: Filtering on computed age
      const results = await store.search([1, 0, 0], {
        k: 10,
        filter: {
          $computed: { // Feature not implemented yet
            ageMinutes: {
              $formula: '(NOW - created) / 60000',
              $lt: 30
            }
          }
        } as any // Cast to any for unimplemented feature
      });

      // Then: Should only return vectors less than 30 minutes old
      expect(results.length).toBe(1);
      expect(results[0]!.metadata.type).toBe('new');
    });
  });

  describe('filter caching', () => {
    it('should cache filter results for repeated queries', async () => {
      // Given: Store with filter caching
      const cachedStore = new VectorStore({ 
        dimension: 3,
        enableFilterCache: true, // Feature not implemented yet
        filterCacheSize: 100
      });
      await cachedStore.initialize();

      // Add test data
      const vectors = Array(1000).fill(null).map((_, i) => ({
        vector: [Math.random(), Math.random(), Math.random()],
        metadata: { 
          category: ['A', 'B', 'C'][i % 3] as string,
          status: i % 10 === 0 ? 'special' : 'normal'
        }
      }));
      await cachedStore.storeBatch(vectors);

      // When: Performing same filter multiple times
      const filter = { category: 'A', status: 'special' };
      
      const start1 = Date.now();
      const results1 = await cachedStore.search([1, 0, 0], { k: 10, filter });
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      const results2 = await cachedStore.search([0, 1, 0], { k: 10, filter });
      const time2 = Date.now() - start2;

      // Then: Second query should use cache (results should be identical)
      expect(results2.length).toBe(results1.length);
      
      // Cache should show improvement (or at least minimal overhead)
      expect(time2).toBeLessThan(time1 * 2); // Allow some variance

      // Verify cache stats - at least one hit occurred
      const cacheStats = await cachedStore.getFilterCacheStats();
      expect(cacheStats.hits).toBeGreaterThanOrEqual(1);
      expect(cacheStats.misses).toBeGreaterThanOrEqual(1);
      expect(cacheStats.hitRate).toBeGreaterThan(0);

      await cachedStore.close();
    });

    it('should invalidate cache on data changes', async () => {
      // Given: Store with filter cache
      const cachedStore = new VectorStore({ 
        dimension: 3,
        enableFilterCache: true
      });
      await cachedStore.initialize();

      await cachedStore.store([1, 0, 0], { type: 'test', version: 1 });

      // Perform initial search
      const filter = { type: 'test' };
      const results1 = await cachedStore.search([1, 0, 0], { k: 10, filter });
      expect(results1.length).toBe(1);

      // When: Adding new matching vector
      await cachedStore.store([0, 1, 0], { type: 'test', version: 2 });

      // Then: Cache should be invalidated and return updated results
      const results2 = await cachedStore.search([1, 0, 0], { k: 10, filter });
      expect(results2.length).toBe(2);

      await cachedStore.close();
    });
  });

  describe('filter statistics and analysis', () => {
    it('should track filter usage statistics', async () => {
      // Given: Store with statistics tracking
      const statsStore = new VectorStore({ 
        dimension: 3,
        trackFilterStats: true // Feature not implemented yet
      });
      await statsStore.initialize();

      // Add data and perform various filtered searches
      await statsStore.storeBatch([
        { vector: [1, 0, 0], metadata: { type: 'A', priority: 1 } },
        { vector: [0, 1, 0], metadata: { type: 'B', priority: 2 } },
        { vector: [0, 0, 1], metadata: { type: 'A', priority: 3 } }
      ]);

      await statsStore.search([1, 0, 0], { k: 10, filter: { type: 'A' } });
      await statsStore.search([1, 0, 0], { k: 10, filter: { type: 'A' } });
      await statsStore.search([1, 0, 0], { k: 10, filter: { priority: 1 } });

      // When: Getting filter statistics
      const stats = await statsStore.getFilterStats();

      // Then: Should show usage patterns
      expect(stats.mostUsedFilters).toContainEqual({
        filter: { type: 'A' },
        count: 2
      });
      expect(stats.filterFieldFrequency).toEqual({
        type: 2,
        priority: 1
      });
      expect(stats.averageFilterComplexity).toBeCloseTo(1, 1); // Single field filters

      await statsStore.close();
    });

    it('should suggest filter optimizations', async () => {
      // Given: Store with optimization suggestions
      const optimizedStore = new VectorStore({ 
        dimension: 3,
        suggestOptimizations: true, // Feature not implemented yet
        trackFilterStats: true
      });
      await optimizedStore.initialize();

      // Add large dataset
      const vectors = Array(10000).fill(null).map((_, i) => ({
        vector: [Math.random(), Math.random(), Math.random()],
        metadata: {
          indexed: `value_${i % 100}`,
          notIndexed: `data_${i}`,
          selective: i === 42 ? 'rare' : 'common'
        }
      }));
      await optimizedStore.storeBatch(vectors);

      // Perform multiple queries to trigger optimization suggestions
      for (let i = 0; i < 15; i++) {
        await optimizedStore.search([1, 0, 0], {
          k: 10,
          filter: {
            notIndexed: `data_${i}`,  // Slow linear scan
            selective: 'common'       // Not selective
          }
        });
      }

      // When: Getting optimization suggestions
      const suggestions = await optimizedStore.getOptimizationSuggestions();

      // Then: Should suggest improvements
      expect(suggestions).toContainEqual({
        type: 'CREATE_INDEX',
        field: 'notIndexed',
        reason: 'Frequently filtered field without index'
      });
      expect(suggestions).toContainEqual({
        type: 'FILTER_ORDER',
        reason: 'Complex filters detected',
        suggestion: 'Filter on selective fields first',
        example: { selective: 'rare', notIndexed: 'data_500' }
      });

      await optimizedStore.close();
    });
  });
});