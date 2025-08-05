import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { ModelMemoryLimiter, ModelConfig, ModelLoadResult, MemoryStats, PerformanceMetrics, CleanupEvent, MemoryUtilizationPoint } from "../../src/intelligence/model-memory-limiter.js";

// Mock logger to prevent console spam in tests
jest.mock("../../src/utils/logger.js", () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  })
}));

// Mock @xenova/transformers with immediate resolution to prevent timeouts
jest.mock("@xenova/transformers", () => ({
  pipeline: jest.fn(() => Promise.resolve(
    jest.fn(() => Promise.resolve({ data: new Float32Array(384) }))
  ))
}));

// Helper function for timeout protection
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string = "Operation"): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        return value;
      },
      (error) => {
        clearTimeout(timeoutId);
        throw error;
      }
    ),
    timeoutPromise
  ]);
}

describe('ModelMemoryLimiter - Comprehensive TDD Red Phase Tests', () => {
  let limiter: ModelMemoryLimiter;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.setTimeout(10000); // 10 second timeout for individual tests
  });

  afterEach(async () => {
    if (limiter) {
      await withTimeout(limiter.close(), 5000, "limiter cleanup").catch(() => {});
    }
  });

  describe('Initialization and Configuration', () => {
    it('should fail with invalid memory limit configuration', async () => {
      // Given: Invalid memory configurations
      const invalidConfigs = [
        { maxMemoryMB: 0 },
        { maxMemoryMB: -100 },
        { maxMemoryMB: NaN },
        { maxMemoryMB: Infinity }
      ];

      // When/Then: Should throw validation errors for each invalid config
      for (const config of invalidConfigs) {
        expect(() => new ModelMemoryLimiter(config as any)).toThrow("Invalid configuration");
      }
    });

    it('should fail with invalid monitoring interval configuration', async () => {
      // Given: Configuration with invalid monitoring intervals
      const invalidConfigs = [
        { maxMemoryMB: 512, monitoringInterval: -1 },
        { maxMemoryMB: 512, monitoringInterval: -1000 },
        { maxMemoryMB: 512, monitoringInterval: NaN }
      ];

      // When/Then: Should throw validation errors
      for (const config of invalidConfigs) {
        expect(() => new ModelMemoryLimiter(config as any)).toThrow("Invalid configuration");
      }
    });

    it('should enforce minimum viable memory limits', async () => {
      // Given: Very small memory limit that's technically valid but impractical
      const tinyMemoryConfig = { maxMemoryMB: 1 };
      
      // When: Creating limiter with tiny memory
      limiter = new ModelMemoryLimiter(tinyMemoryConfig);
      await limiter.initialize();

      // Then: Should initialize but fail on any model loading attempt
      const result = await limiter.loadModel({
        modelId: "tiny-model",
        dimension: 384,
        estimatedMemoryMB: 50
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("memory limit");
    });

    it('should initialize monitoring with custom intervals correctly', async () => {
      // Given: Custom monitoring configuration
      const customConfig = {
        maxMemoryMB: 512,
        monitoringInterval: 100,
        emergencyCleanup: true
      };

      // When: Initializing with custom config
      limiter = new ModelMemoryLimiter(customConfig);
      await limiter.initialize();

      // Then: Should use exact custom values
      expect(limiter.isMonitoringActive()).toBe(true);
      const stats = limiter.getMemoryStats();
      expect(stats.monitoringIntervalMs).toBe(100);
      expect(stats.monitoringActive).toBe(true);
    });

    it('should handle empty fallback models gracefully', async () => {
      // Given: Configuration with empty fallback array
      const configWithEmptyFallbacks = {
        maxMemoryMB: 512,
        fallbackModels: []
      };

      // When: Creating limiter
      limiter = new ModelMemoryLimiter(configWithEmptyFallbacks);
      await limiter.initialize();

      // Then: Should use default fallbacks internally
      const result = await limiter.loadModel({
        modelId: "huge-model-that-exceeds-limit",
        dimension: 4096,
        estimatedMemoryMB: 1000
      });

      expect(result.fallbackUsed).toBe(true);
      expect(result.success).toBe(true); // Should fallback to defaults
    });
  });

  describe('Memory Monitoring Advanced Scenarios', () => {
    beforeEach(async () => {
      limiter = new ModelMemoryLimiter({
        maxMemoryMB: 512,
        monitoringInterval: 50
      });
      await limiter.initialize();
    });

    it('should detect rapid memory spikes during concurrent loading', async () => {
      // Given: Multiple large models loading simultaneously
      const largeModels = Array.from({ length: 10 }, (_, i) => ({
        modelId: `concurrent-model-${i}`,
        dimension: 1024,
        estimatedMemoryMB: 100
      }));

      // When: Loading all models concurrently (should exceed limit)
      const loadPromises = largeModels.map(model => 
        limiter.loadModel(model).catch(error => ({ success: false, error: error.message }))
      );
      
      const results = await Promise.all(loadPromises);

      // Then: Should prevent memory overflow through proper coordination
      const successfulLoads = results.filter(r => r.success);
      const stats = limiter.getMemoryStats();
      
      expect(stats.currentMemoryMB).toBeLessThanOrEqual(512);
      expect(successfulLoads.length).toBeLessThan(largeModels.length); // Some should fail
    });

    it('should maintain accurate memory tracking during failures', async () => {
      // Given: Mix of valid and invalid models
      const mixedModels = [
        { modelId: "valid-model-1", dimension: 384, estimatedMemoryMB: 100 },
        { modelId: "invalid-nonexistent-model", dimension: 384, estimatedMemoryMB: 100 },
        { modelId: "valid-model-2", dimension: 384, estimatedMemoryMB: 150 }
      ];

      // When: Loading mixed models
      const results = await Promise.all(
        mixedModels.map(model => limiter.loadModel(model))
      );

      // Then: Memory accounting should remain accurate despite failures
      const stats = limiter.getMemoryStats();
      const successfulLoads = results.filter(r => r.success);
      
      expect(stats.modelsLoaded).toBe(successfulLoads.length);
      expect(stats.currentMemoryMB).toBeGreaterThan(0);
      expect(stats.utilizationPercent).toBeLessThanOrEqual(100);
    });

    it('should handle monitoring failures and recovery cycles', async () => {
      // Given: Active monitoring
      expect(limiter.isMonitoringActive()).toBe(true);
      const initialStats = limiter.getMemoryStats();

      // When: Simulating multiple monitoring failures
      limiter.simulateMonitoringFailure();
      await new Promise(resolve => setTimeout(resolve, 150)); // Wait for recovery
      limiter.simulateMonitoringFailure();
      await new Promise(resolve => setTimeout(resolve, 150)); // Wait for recovery

      // Then: Should track errors but maintain functionality
      const finalStats = limiter.getMemoryStats();
      expect(finalStats.monitoringErrors).toBeGreaterThan(initialStats.monitoringErrors);
      expect(limiter.isMonitoringActive()).toBe(true); // Should recover
    });

    it('should capture detailed utilization history patterns', async () => {
      // Given: Sequence of memory operations
      const modelSequence = [
        { modelId: "pattern-model-1", dimension: 384, estimatedMemoryMB: 100 },
        { modelId: "pattern-model-2", dimension: 384, estimatedMemoryMB: 200 },
        { modelId: "pattern-model-3", dimension: 384, estimatedMemoryMB: 150 }
      ];

      // When: Loading models in sequence with delays for monitoring
      for (const model of modelSequence) {
        await limiter.loadModel(model);
        await new Promise(resolve => setTimeout(resolve, 100)); // Allow monitoring to capture
      }

      // Unload some models
      await limiter.unloadModel("pattern-model-1");
      await new Promise(resolve => setTimeout(resolve, 100));

      // Then: Should have detailed utilization history
      const history = limiter.getMemoryUtilizationHistory();
      expect(history.length).toBeGreaterThan(3);
      
      // Verify history structure
      for (const point of history) {
        expect(point).toHaveProperty('timestamp');
        expect(point).toHaveProperty('utilizationPercent');
        expect(point.timestamp).toBeGreaterThan(0);
        expect(point.utilizationPercent).toBeGreaterThanOrEqual(0);
        expect(point.utilizationPercent).toBeLessThanOrEqual(100);
      }

      // History should show variation (not all same values)
      const uniqueUtilizations = new Set(history.map(h => h.utilizationPercent));
      expect(uniqueUtilizations.size).toBeGreaterThan(1);
    });
  });

  describe('Memory Limit Enforcement Edge Cases', () => {
    it('should prevent memory reservation race conditions', async () => {
      // Given: Limiter with small memory limit
      limiter = new ModelMemoryLimiter({ maxMemoryMB: 200 });
      await limiter.initialize();

      // When: Multiple models trying to reserve memory simultaneously
      const competingModels = [
        { modelId: "race-model-1", dimension: 384, estimatedMemoryMB: 150 },
        { modelId: "race-model-2", dimension: 384, estimatedMemoryMB: 150 },
        { modelId: "race-model-3", dimension: 384, estimatedMemoryMB: 150 }
      ];

      const loadPromises = competingModels.map(model => limiter.loadModel(model));
      const results = await Promise.all(loadPromises);

      // Then: Should not over-allocate memory
      const stats = limiter.getMemoryStats();
      expect(stats.currentMemoryMB).toBeLessThanOrEqual(200);
      
      const successfulLoads = results.filter(r => r.success);
      expect(successfulLoads.length).toBeLessThan(competingModels.length);
    });

    it('should handle exact memory limit boundary conditions', async () => {
      // Given: Limiter configured for exactly one model
      limiter = new ModelMemoryLimiter({ maxMemoryMB: 100 });
      await limiter.initialize();

      // When: Loading model that exactly matches limit
      const exactModel = {
        modelId: "exact-fit-model",
        dimension: 384,
        estimatedMemoryMB: 100
      };

      const result = await limiter.loadModel(exactModel);

      // Then: Should succeed with exact fit
      expect(result.success).toBe(true);
      
      const stats = limiter.getMemoryStats();
      expect(stats.currentMemoryMB).toBeLessThanOrEqual(100);
      expect(stats.utilizationPercent).toBeGreaterThan(90); // Near full utilization
    });

    it('should enforce memory limits during emergency cleanup', async () => {
      // Given: Limiter with models loaded beyond safe threshold
      limiter = new ModelMemoryLimiter({ 
        maxMemoryMB: 400,
        emergencyCleanup: true 
      });
      await limiter.initialize();

      // Load models to high utilization
      const models = [
        { modelId: "cleanup-model-1", dimension: 384, estimatedMemoryMB: 150 },
        { modelId: "cleanup-model-2", dimension: 384, estimatedMemoryMB: 150 },
        { modelId: "cleanup-model-3", dimension: 384, estimatedMemoryMB: 150 }
      ];

      for (const model of models) {
        await limiter.loadModel(model);
      }

      // When: Triggering emergency cleanup
      await limiter.emergencyCleanup();

      // Then: Should bring memory below 80% threshold
      const stats = limiter.getMemoryStats();
      expect(stats.currentMemoryMB).toBeLessThan(400 * 0.8); // Below 80%
      
      const cleanupHistory = limiter.getCleanupHistory();
      expect(cleanupHistory.length).toBeGreaterThan(0);
      expect(cleanupHistory[cleanupHistory.length - 1].memoryFreed).toBeGreaterThan(0);
    });

    it('should handle cleanup failures without corrupting state', async () => {
      // Given: Limiter with cleanup failures simulated
      limiter = new ModelMemoryLimiter({
        maxMemoryMB: 300,
        emergencyCleanup: true
      });
      await limiter.initialize();

      // Load a model first
      await limiter.loadModel({
        modelId: "cleanup-failure-model",
        dimension: 384,
        estimatedMemoryMB: 100
      });

      // When: Simulating cleanup failure and attempting cleanup
      limiter.simulateCleanupFailure();
      await limiter.emergencyCleanup();

      // Then: Should handle failure gracefully
      const stats = limiter.getMemoryStats();
      expect(stats).toBeDefined();
      expect(stats.currentMemoryMB).toBeGreaterThanOrEqual(0);
      
      const cleanupHistory = limiter.getCleanupHistory();
      expect(cleanupHistory.length).toBeGreaterThan(0); // Should still record attempt
    });
  });

  describe('Model Management Complex Scenarios', () => {
    beforeEach(async () => {
      limiter = new ModelMemoryLimiter({
        maxMemoryMB: 500,
        fallbackModels: [
          "Xenova/all-MiniLM-L6-v2",
          "Xenova/all-MiniLM-L12-v2"
        ]
      });
      await limiter.initialize();
    });

    it('should handle model loading timeout scenarios correctly', async () => {
      // Given: Limiter with very short timeout
      const shortTimeoutLimiter = new ModelMemoryLimiter({
        maxMemoryMB: 500,
        loadTimeout: 50 // Very short timeout
      });
      await shortTimeoutLimiter.initialize();

      try {
        // When: Loading model that will timeout
        const result = await shortTimeoutLimiter.loadModel({
          modelId: "slow-loading-model-timeout-test",
          dimension: 384,
          estimatedMemoryMB: 100
        });

        // Then: Should timeout gracefully
        expect(result.success).toBe(false);
        expect(result.error).toContain("timeout");
        expect(result.loadTimeMs).toBeGreaterThan(0);
        
        // Memory state should remain consistent
        const stats = shortTimeoutLimiter.getMemoryStats();
        expect(stats.currentMemoryMB).toBe(0); // No memory allocated for failed load
      } finally {
        await shortTimeoutLimiter.close();
      }
    });

    it('should manage fallback model selection intelligently', async () => {
      // Given: Custom fallback hierarchy
      const fallbackLimiter = new ModelMemoryLimiter({
        maxMemoryMB: 200,
        fallbackModels: [
          "small-fallback-model",
          "medium-fallback-model", 
          "large-fallback-model"
        ]
      });
      await fallbackLimiter.initialize();

      try {
        // When: Loading model that exceeds limit
        const result = await fallbackLimiter.loadModel({
          modelId: "oversized-primary-model",
          dimension: 2048,
          estimatedMemoryMB: 300
        });

        // Then: Should use appropriate fallback
        expect(result.success).toBe(true);
        expect(result.fallbackUsed).toBe(true);
        expect(result.fallbackReason).toContain("memory limit");
        expect(result.modelId).toBe("small-fallback-model"); // Should pick first viable option
      } finally {
        await fallbackLimiter.close();
      }
    });

    it('should prevent duplicate model loading attempts', async () => {
      // Given: Model that's already loaded
      const firstResult = await limiter.loadModel({
        modelId: "duplicate-test-model",
        dimension: 384,
        estimatedMemoryMB: 100
      });
      expect(firstResult.success).toBe(true);

      // When: Attempting to load same model again
      const secondResult = await limiter.loadModel({
        modelId: "duplicate-test-model",
        dimension: 384,
        estimatedMemoryMB: 100
      });

      // Then: Should return existing model info without reloading
      expect(secondResult.success).toBe(true);
      expect(secondResult.modelId).toBe("duplicate-test-model");
      expect(secondResult.fallbackUsed).toBe(false);
      
      // Should not double-allocate memory
      const stats = limiter.getMemoryStats();
      expect(stats.modelsLoaded).toBe(1); // Still just one model
    });

    it('should handle concurrent loading of same model', async () => {
      // Given: Multiple simultaneous requests for same model
      const modelConfig = {
        modelId: "concurrent-same-model",
        dimension: 384,
        estimatedMemoryMB: 150
      };

      // When: Loading same model concurrently
      const loadPromises = Array.from({ length: 5 }, () => 
        limiter.loadModel(modelConfig)
      );
      
      const results = await Promise.all(loadPromises);

      // Then: All should succeed with same result
      for (const result of results) {
        expect(result.success).toBe(true);
        expect(result.modelId).toBe("concurrent-same-model");
      }

      // But only one instance should be loaded
      const stats = limiter.getMemoryStats();
      expect(stats.modelsLoaded).toBe(1);
    });
  });

  describe('Integration with Intelligence Layer', () => {
    beforeEach(async () => {
      limiter = new ModelMemoryLimiter({
        maxMemoryMB: 800,
        monitoringInterval: 100,
        emergencyCleanup: true
      });
      await limiter.initialize();
    });

    it('should integrate with embedding generation workflows', async () => {
      // Given: Models loaded for embedding generation
      const embeddingModels = [
        { modelId: "embedding-model-small", dimension: 384, estimatedMemoryMB: 120 },
        { modelId: "embedding-model-large", dimension: 768, estimatedMemoryMB: 200 }
      ];

      // When: Loading models for embedding pipeline
      const results = await Promise.all(
        embeddingModels.map(model => limiter.loadModel(model))
      );

      // Then: Should support embedding generation workflow
      expect(results.every(r => r.success)).toBe(true);
      
      const stats = limiter.getMemoryStats();
      expect(stats.modelsLoaded).toBe(2);
      expect(stats.currentMemoryMB).toBeGreaterThan(300); // Combined memory usage
    });

    it('should handle intelligence layer memory pressure scenarios', async () => {
      // Given: High memory pressure from intelligence operations
      const heavyModels = Array.from({ length: 8 }, (_, i) => ({
        modelId: `intelligence-model-${i}`,
        dimension: 512,
        estimatedMemoryMB: 120
      }));

      // When: Loading models until memory pressure
      const results = [];
      for (const model of heavyModels) {
        const result = await limiter.loadModel(model);
        results.push(result);
        
        if (limiter.isMemoryUnderPressure()) {
          break; // Stop when pressure is detected
        }
      }

      // Then: Should manage memory pressure intelligently
      expect(limiter.isMemoryUnderPressure()).toBe(true);
      const stats = limiter.getMemoryStats();
      expect(stats.utilizationPercent).toBeGreaterThan(80);
      
      // Cleanup should occur automatically
      await new Promise(resolve => setTimeout(resolve, 200)); // Wait for monitoring cycle
      
      const cleanupHistory = limiter.getCleanupHistory();
      expect(cleanupHistory.length).toBeGreaterThan(0);
    });

    it('should provide real-time memory feedback for intelligence operations', async () => {
      // Given: Models being loaded and unloaded dynamically
      const dynamicModels = [
        { modelId: "dynamic-model-1", dimension: 384, estimatedMemoryMB: 100 },
        { modelId: "dynamic-model-2", dimension: 512, estimatedMemoryMB: 150 },
        { modelId: "dynamic-model-3", dimension: 768, estimatedMemoryMB: 200 }
      ];

      const utilizationSnapshots = [];

      // When: Performing dynamic loading/unloading
      for (const model of dynamicModels) {
        await limiter.loadModel(model);
        utilizationSnapshots.push(limiter.getMemoryStats().utilizationPercent);
        await new Promise(resolve => setTimeout(resolve, 50)); // Allow monitoring
      }

      // Unload middle model
      await limiter.unloadModel("dynamic-model-2");
      utilizationSnapshots.push(limiter.getMemoryStats().utilizationPercent);

      // Then: Should provide accurate real-time feedback
      expect(utilizationSnapshots.length).toBe(4);
      expect(utilizationSnapshots[2]).toBeGreaterThan(utilizationSnapshots[1]); // Increasing
      expect(utilizationSnapshots[3]).toBeLessThan(utilizationSnapshots[2]); // Decreasing after unload

      const history = limiter.getMemoryUtilizationHistory();
      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Recovery', () => {
    beforeEach(async () => {
      limiter = new ModelMemoryLimiter({
        maxMemoryMB: 400,
        monitoringInterval: 100
      });
      await limiter.initialize();
    });

    it('should recover from catastrophic memory allocation failures', async () => {
      // Given: Scenario that would cause allocation failures
      const catastrophicModels = [
        { modelId: "huge-memory-model-1", dimension: 4096, estimatedMemoryMB: 500 },
        { modelId: "huge-memory-model-2", dimension: 4096, estimatedMemoryMB: 500 }
      ];

      // When: Attempting to load models that exceed system capacity
      const results = await Promise.all(
        catastrophicModels.map(model => limiter.loadModel(model))
      );

      // Then: Should handle failures gracefully without corruption
      const successfulLoads = results.filter(r => r.success);
      const stats = limiter.getMemoryStats();
      
      expect(stats.currentMemoryMB).toBeLessThanOrEqual(400);
      expect(successfulLoads.length).toBeLessThan(catastrophicModels.length);
      
      // Should maintain state consistency
      expect(stats.modelsLoaded).toBe(successfulLoads.length);
    });

    it('should handle system memory pressure gracefully', async () => {
      // Given: Simulated system memory pressure
      let systemMemoryPressure = false;
      
      // Mock memory allocation to simulate system pressure
      const originalEstimate = (limiter as any).estimateModelMemory;
      (limiter as any).estimateModelMemory = (modelId: string) => {
        if (systemMemoryPressure) {
          throw new Error("System memory pressure");
        }
        return originalEstimate.call(limiter, modelId);
      };

      // When: Loading model, then simulating system pressure
      const firstModel = await limiter.loadModel({
        modelId: "pressure-test-model-1",
        dimension: 384,
        estimatedMemoryMB: 100
      });
      expect(firstModel.success).toBe(true);

      systemMemoryPressure = true;
      
      const secondModel = await limiter.loadModel({
        modelId: "pressure-test-model-2", 
        dimension: 384,
        estimatedMemoryMB: 100
      });

      // Then: Should handle system pressure gracefully
      expect(secondModel.success).toBe(false);
      
      const stats = limiter.getMemoryStats();
      expect(stats.modelsLoaded).toBe(1); // Only first model should remain
    });

    it('should maintain consistency during monitoring failures', async () => {
      // Given: Active monitoring with loaded models
      await limiter.loadModel({
        modelId: "monitoring-failure-model",
        dimension: 384,
        estimatedMemoryMB: 150
      });

      const initialStats = limiter.getMemoryStats();

      // When: Simulating persistent monitoring failures
      limiter.simulateMonitoringFailure();
      await new Promise(resolve => setTimeout(resolve, 150));
      limiter.simulateMonitoringFailure();
      await new Promise(resolve => setTimeout(resolve, 150));

      // Then: Core functionality should remain intact
      const finalStats = limiter.getMemoryStats();
      expect(finalStats.modelsLoaded).toBe(initialStats.modelsLoaded);
      expect(finalStats.currentMemoryMB).toBe(initialStats.currentMemoryMB);
      expect(finalStats.monitoringErrors).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle zero-memory models', async () => {
      // Given: Limiter with standard config
      limiter = new ModelMemoryLimiter({ maxMemoryMB: 100 });
      await limiter.initialize();

      // When: Loading model with zero estimated memory
      const result = await limiter.loadModel({
        modelId: "zero-memory-model",
        dimension: 1,
        estimatedMemoryMB: 0
      });

      // Then: Should handle gracefully
      expect(result.success).toBe(true);
      expect(result.actualMemoryMB).toBeGreaterThanOrEqual(0);
    });

    it('should handle models with extreme dimensions', async () => {
      // Given: Standard limiter
      limiter = new ModelMemoryLimiter({ maxMemoryMB: 1000 });
      await limiter.initialize();

      const extremeModels = [
        { modelId: "tiny-dimension-model", dimension: 1, estimatedMemoryMB: 50 },
        { modelId: "huge-dimension-model", dimension: 10000, estimatedMemoryMB: 200 }
      ];

      // When: Loading models with extreme dimensions
      const results = await Promise.all(
        extremeModels.map(model => limiter.loadModel(model))
      );

      // Then: Should handle all dimension ranges
      for (const result of results) {
        expect(result.success).toBe(true);
        expect(result.actualMemoryMB).toBeGreaterThan(0);
      }
    });

    it('should handle rapid load/unload cycles', async () => {
      // Given: Standard limiter
      limiter = new ModelMemoryLimiter({ maxMemoryMB: 300 });
      await limiter.initialize();

      // When: Performing rapid load/unload cycles
      for (let i = 0; i < 10; i++) {
        const loadResult = await limiter.loadModel({
          modelId: `cycle-model-${i}`,
          dimension: 384,
          estimatedMemoryMB: 100
        });
        
        expect(loadResult.success).toBe(true);
        
        const unloadResult = await limiter.unloadModel(`cycle-model-${i}`);
        expect(unloadResult.success).toBe(true);
      }

      // Then: Should maintain memory consistency
      const stats = limiter.getMemoryStats();
      expect(stats.modelsLoaded).toBe(0);
      expect(stats.currentMemoryMB).toBe(0);
    });

    it('should handle models with special characters in IDs', async () => {
      // Given: Standard limiter
      limiter = new ModelMemoryLimiter({ maxMemoryMB: 500 });
      await limiter.initialize();

      const specialIdModels = [
        { modelId: "model/with-slash", dimension: 384, estimatedMemoryMB: 100 },
        { modelId: "model@with-at", dimension: 384, estimatedMemoryMB: 100 },
        { modelId: "model_with_underscores", dimension: 384, estimatedMemoryMB: 100 },
        { modelId: "model-with-unicode-🤖", dimension: 384, estimatedMemoryMB: 100 }
      ];

      // When: Loading models with special ID characters
      const results = await Promise.all(
        specialIdModels.map(model => limiter.loadModel(model))
      );

      // Then: Should handle all ID formats
      for (let i = 0; i < results.length; i++) {
        expect(results[i].success).toBe(true);
        expect(results[i].modelId).toBe(specialIdModels[i].modelId);
      }
    });
  });

  describe('Performance and Scalability Edge Cases', () => {
    it('should maintain performance with many loaded models', async () => {
      // Given: Limiter with high memory limit
      limiter = new ModelMemoryLimiter({ maxMemoryMB: 2000 });
      await limiter.initialize();

      // When: Loading many small models
      const manyModels = Array.from({ length: 50 }, (_, i) => ({
        modelId: `performance-model-${i}`,
        dimension: 384,
        estimatedMemoryMB: 30
      }));

      const startTime = Date.now();
      const results = await Promise.all(
        manyModels.map(model => limiter.loadModel(model))
      );
      const loadTime = Date.now() - startTime;

      // Then: Should maintain reasonable performance
      expect(loadTime).toBeLessThan(10000); // Should complete within 10 seconds
      
      const successfulLoads = results.filter(r => r.success);
      expect(successfulLoads.length).toBeLessThanOrEqual(manyModels.length);

      // Memory stats should remain accurate
      const stats = limiter.getMemoryStats();
      expect(stats.modelsLoaded).toBe(successfulLoads.length);
    });

    it('should handle memory utilization history at scale', async () => {
      // Given: Limiter with fast monitoring
      limiter = new ModelMemoryLimiter({
        maxMemoryMB: 1000,
        monitoringInterval: 10 // Very fast monitoring
      });
      await limiter.initialize();

      // When: Generating lots of utilization data
      for (let i = 0; i < 20; i++) {
        await limiter.loadModel({
          modelId: `history-model-${i}`,
          dimension: 384,
          estimatedMemoryMB: 40
        });
        await new Promise(resolve => setTimeout(resolve, 20)); // Allow monitoring
      }

      // Then: Should maintain bounded history
      const history = limiter.getMemoryUtilizationHistory();
      expect(history.length).toBeLessThanOrEqual(100); // Should cap at 100 points
      expect(history.length).toBeGreaterThan(10); // Should have substantial data
    });

    it('should handle cleanup history efficiently', async () => {
      // Given: Limiter configured for frequent cleanups
      limiter = new ModelMemoryLimiter({
        maxMemoryMB: 300,
        emergencyCleanup: true,
        monitoringInterval: 50
      });
      await limiter.initialize();

      // When: Triggering multiple cleanup cycles
      for (let cycle = 0; cycle < 10; cycle++) {
        // Load models to trigger cleanup
        await limiter.loadModel({
          modelId: `cleanup-cycle-model-${cycle}-1`,
          dimension: 384,
          estimatedMemoryMB: 120
        });
        await limiter.loadModel({
          modelId: `cleanup-cycle-model-${cycle}-2`,
          dimension: 384,
          estimatedMemoryMB: 120
        });
        await limiter.loadModel({
          modelId: `cleanup-cycle-model-${cycle}-3`,
          dimension: 384,
          estimatedMemoryMB: 120
        });

        // Force cleanup
        await limiter.emergencyCleanup();
        await new Promise(resolve => setTimeout(resolve, 60)); // Allow monitoring
      }

      // Then: Should maintain cleanup history efficiently
      const cleanupHistory = limiter.getCleanupHistory();
      expect(cleanupHistory.length).toBeGreaterThan(5);
      
      // Each cleanup event should have proper structure
      for (const event of cleanupHistory) {
        expect(event).toHaveProperty('timestamp');
        expect(event).toHaveProperty('reason');
        expect(event).toHaveProperty('memoryFreed');
        expect(event).toHaveProperty('modelsUnloaded');
        expect(event.timestamp).toBeGreaterThan(0);
      }
    });
  });
});