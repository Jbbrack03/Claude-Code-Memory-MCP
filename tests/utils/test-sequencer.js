// Use CommonJS for Jest sequencer compatibility
const { Sequencer } = require('@jest/test-sequencer');

class CustomSequencer extends Sequencer {
  sort(tests) {
    // Create a sorted copy of tests
    const copyTests = [...tests];
    
    return copyTests.sort((testA, testB) => {
      const pathA = testA.path;
      const pathB = testB.path;
      
      // Priority order for test execution
      const getPriority = (path) => {
        // Unit tests first (fastest)
        if (path.includes('/unit/') || path.includes('test-helpers') || path.includes('test-cleanup')) {
          return 1;
        }
        
        // Storage tests (medium speed)
        if (path.includes('/storage/')) {
          return 2;
        }
        
        // Hooks tests (medium speed)
        if (path.includes('/hooks/')) {
          return 3;
        }
        
        // Git tests (medium speed)
        if (path.includes('/git/')) {
          return 4;
        }
        
        // Intelligence tests (slower due to AI models)
        if (path.includes('/intelligence/')) {
          return 5;
        }
        
        // Monitoring tests (slower due to metrics/tracing)
        if (path.includes('/monitoring/')) {
          return 6;
        }
        
        // Integration tests (slowest)
        if (path.includes('/integration/')) {
          return 7;
        }
        
        // Performance tests (slowest)
        if (path.includes('/performance/')) {
          return 8;
        }
        
        // E2E tests (slowest)
        if (path.includes('/e2e/')) {
          return 9;
        }
        
        // Default priority for other tests
        return 5;
      };
      
      const priorityA = getPriority(pathA);
      const priorityB = getPriority(pathB);
      
      // Primary sort by priority
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      // Secondary sort by file size (smaller files first within same priority)
      try {
        const sizeA = testA.stats ? testA.stats.size : 0;
        const sizeB = testB.stats ? testB.stats.size : 0;
        
        if (sizeA !== sizeB) {
          return sizeA - sizeB;
        }
      } catch (error) {
        // Ignore size comparison errors
      }
      
      // Tertiary sort alphabetically
      return pathA.localeCompare(pathB);
    });
  }
}

module.exports = CustomSequencer;