import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { ModelMemoryLimiter, ModelConfig, ModelLoadResult, MemoryStats } from "../../src/intelligence/model-memory-limiter.js";
import type { Config } from "../../src/config/index.js";

// Mock logger
jest.mock("../../src/utils/logger.js", () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  })
}));

// Mock @xenova/transformers
jest.mock("@xenova/transformers");

describe('ModelMemoryLimiter', () => {
  let limiter: ModelMemoryLimiter;
  let mockMemoryMonitor: jest.Mock;
  let mockModelLoader: jest.Mock;
  let config: Config["intelligence"]["memoryLimiter"];

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mocks
    mockMemoryMonitor = jest.fn();
    mockModelLoader = jest.fn();
    
    // Setup config
    config = {
      maxMemoryMB: 512,
      fallbackModels: [
        "Xenova/all-MiniLM-L6-v2",
        "Xenova/all-MiniLM-L12-v2"
      ],
      monitoringInterval: 1000,
      emergencyCleanup: true,
      loadTimeout: 30000
    };
  });

  afterEach(async () => {
    if (limiter) {
      await limiter.close().catch(() => {});
    }
  });

  describe('initialization', () => {
    it('should initialize successfully with valid config', async () => {
      // Given: Valid configuration
      limiter = new ModelMemoryLimiter(config);
      
      // When: Initializing
      await limiter.initialize();
      
      // Then: Should be initialized
      expect(limiter.isInitialized()).toBe(true);
      const stats = limiter.getMemoryStats();
      expect(stats.maxMemoryMB).toBe(512);
      expect(stats.currentMemoryMB).toBe(0);
      expect(stats.modelsLoaded).toBe(0);
    });

    it('should throw error when not initialized', async () => {
      // Given: Limiter not initialized
      limiter = new ModelMemoryLimiter(config);
      
      // When/Then: Methods should throw
      await expect(limiter.loadModel({ modelId: "test", dimension: 384 })).rejects.toThrow("ModelMemoryLimiter not initialized");
      expect(() => limiter.getMemoryStats()).toThrow("ModelMemoryLimiter not initialized");
      await expect(limiter.unloadModel("test")).rejects.toThrow("ModelMemoryLimiter not initialized");
    });

    it('should prevent double initialization', async () => {
      // Given: Limiter already initialized
      limiter = new ModelMemoryLimiter(config);
      await limiter.initialize();
      
      // When/Then: Second initialization should not throw
      await expect(limiter.initialize()).resolves.not.toThrow();
      expect(limiter.isInitialized()).toBe(true);
    });

    it('should start memory monitoring on initialization', async () => {
      // Given: Configuration with monitoring enabled
      limiter = new ModelMemoryLimiter(config);
      
      // When: Initializing
      await limiter.initialize();
      
      // Then: Memory monitoring should be active
      expect(limiter.isMonitoringActive()).toBe(true);
      
      const stats = limiter.getMemoryStats();
      expect(stats.monitoringActive).toBe(true);
    });
  });

  describe('model loading', () => {
    beforeEach(async () => {
      limiter = new ModelMemoryLimiter(config);
      await limiter.initialize();
    });

    it('should load model successfully when memory available', async () => {
      // Given: Model configuration and available memory
      const modelConfig: ModelConfig = {
        modelId: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
        estimatedMemoryMB: 100
      };
      
      // When: Loading model
      const result = await limiter.loadModel(modelConfig);
      
      // Then: Model should be loaded successfully
      expect(result.success).toBe(true);
      expect(result.modelId).toBe("Xenova/all-MiniLM-L6-v2");
      expect(result.actualMemoryMB).toBeGreaterThan(0);
      expect(result.fallbackUsed).toBe(false);
      
      const stats = limiter.getMemoryStats();
      expect(stats.modelsLoaded).toBe(1);
      expect(stats.currentMemoryMB).toBeGreaterThan(0);
    });

    it('should use fallback model when primary model exceeds memory limit', async () => {
      // Given: Model that exceeds memory limit
      const modelConfig: ModelConfig = {
        modelId: "large-model/bert-large",
        dimension: 1024,
        estimatedMemoryMB: 600 // Exceeds 512MB limit
      };
      
      // When: Loading model
      const result = await limiter.loadModel(modelConfig);
      
      // Then: Should fallback to smaller model
      expect(result.success).toBe(true);
      expect(result.modelId).toBe("Xenova/all-MiniLM-L6-v2"); // First fallback
      expect(result.fallbackUsed).toBe(true);
      expect(result.fallbackReason).toContain("memory limit");
    });

    it('should fail when all fallback models exceed memory limit', async () => {
      // Given: Very low memory limit and large model
      const lowMemoryConfig = { ...config, maxMemoryMB: 50 };
      limiter = new ModelMemoryLimiter(lowMemoryConfig);
      await limiter.initialize();
      
      const modelConfig: ModelConfig = {
        modelId: "huge-model/gpt-3",
        dimension: 4096,
        estimatedMemoryMB: 2000
      };
      
      // When: Loading model
      const result = await limiter.loadModel(modelConfig);
      
      // Then: Should fail completely
      expect(result.success).toBe(false);
      expect(result.error).toContain("memory limit");
      expect(result.fallbackUsed).toBe(true);
    });

    it('should timeout loading when model takes too long', async () => {
      // Given: Configuration with short timeout
      const shortTimeoutConfig = { ...config, loadTimeout: 100 };
      limiter = new ModelMemoryLimiter(shortTimeoutConfig);
      await limiter.initialize();
      
      const modelConfig: ModelConfig = {
        modelId: "slow-loading-model",
        dimension: 384,
        estimatedMemoryMB: 100
      };
      
      // When: Loading model (simulate slow loading)
      const result = await limiter.loadModel(modelConfig);
      
      // Then: Should timeout
      expect(result.success).toBe(false);
      expect(result.error).toContain("timeout");
    });

    it('should handle concurrent model loading requests', async () => {
      // Given: Multiple model configurations
      const models = [
        { modelId: "model-1", dimension: 384, estimatedMemoryMB: 100 },
        { modelId: "model-2", dimension: 384, estimatedMemoryMB: 150 },
        { modelId: "model-3", dimension: 384, estimatedMemoryMB: 200 }
      ];
      
      // When: Loading models concurrently
      const results = await Promise.all(
        models.map(model => limiter.loadModel(model))
      );
      
      // Then: Should handle concurrent requests properly
      const successfulLoads = results.filter(r => r.success);
      expect(successfulLoads.length).toBeGreaterThan(0);
      
      // Total memory should not exceed limit
      const stats = limiter.getMemoryStats();
      expect(stats.currentMemoryMB).toBeLessThanOrEqual(config.maxMemoryMB);
    });
  });

  describe('model unloading', () => {
    beforeEach(async () => {
      limiter = new ModelMemoryLimiter(config);
      await limiter.initialize();
      
      // Load a test model
      await limiter.loadModel({
        modelId: "test-model",
        dimension: 384,
        estimatedMemoryMB: 100
      });
    });

    it('should unload model successfully', async () => {
      // Given: Loaded model
      const initialStats = limiter.getMemoryStats();
      expect(initialStats.modelsLoaded).toBe(1);
      
      // When: Unloading model
      const result = await limiter.unloadModel("test-model");
      
      // Then: Model should be unloaded
      expect(result.success).toBe(true);
      expect(result.memoryFreed).toBeGreaterThan(0);
      
      const finalStats = limiter.getMemoryStats();
      expect(finalStats.modelsLoaded).toBe(0);
      expect(finalStats.currentMemoryMB).toBeLessThan(initialStats.currentMemoryMB);
    });

    it('should handle unloading non-existent model', async () => {
      // Given: Non-existent model ID
      const modelId = "non-existent-model";
      
      // When: Unloading model
      const result = await limiter.unloadModel(modelId);
      
      // Then: Should return appropriate response
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it('should unload oldest models when memory pressure detected', async () => {
      // Given: Multiple models loaded near memory limit
      const models = [
        { modelId: "model-1", dimension: 384, estimatedMemoryMB: 150 },
        { modelId: "model-2", dimension: 384, estimatedMemoryMB: 150 },
        { modelId: "model-3", dimension: 384, estimatedMemoryMB: 150 }
      ];
      
      for (const model of models) {
        await limiter.loadModel(model);
      }
      
      // When: Triggering emergency cleanup
      await limiter.emergencyCleanup();
      
      // Then: Should free up memory by unloading oldest models
      const stats = limiter.getMemoryStats();
      expect(stats.currentMemoryMB).toBeLessThan(config.maxMemoryMB * 0.8); // Below 80% threshold
    });
  });

  describe('memory monitoring', () => {
    beforeEach(async () => {
      limiter = new ModelMemoryLimiter(config);
      await limiter.initialize();
    });

    it('should provide accurate memory statistics', async () => {
      // Given: Fresh limiter
      const initialStats = limiter.getMemoryStats();
      
      // When: Loading a model
      await limiter.loadModel({
        modelId: "test-model",
        dimension: 384,
        estimatedMemoryMB: 100
      });
      
      // Then: Statistics should be updated
      const updatedStats = limiter.getMemoryStats();
      expect(updatedStats.modelsLoaded).toBe(initialStats.modelsLoaded + 1);
      expect(updatedStats.currentMemoryMB).toBeGreaterThan(initialStats.currentMemoryMB);
      expect(updatedStats.maxMemoryMB).toBe(config.maxMemoryMB);
      expect(updatedStats.utilizationPercent).toBeGreaterThan(0);
      expect(updatedStats.utilizationPercent).toBeLessThanOrEqual(100);
    });

    it('should detect memory pressure', async () => {
      // Given: Models loaded near limit
      const models = Array.from({ length: 4 }, (_, i) => ({
        modelId: `model-${i}`,
        dimension: 384,
        estimatedMemoryMB: 120
      }));
      
      for (const model of models) {
        await limiter.loadModel(model);
      }
      
      // When: Checking memory pressure
      const isUnderPressure = limiter.isMemoryUnderPressure();
      const stats = limiter.getMemoryStats();
      
      // Then: Should detect pressure
      expect(isUnderPressure).toBe(true);
      expect(stats.utilizationPercent).toBeGreaterThan(80); // High utilization
    });

    it('should trigger automatic cleanup when threshold exceeded', async () => {
      // Given: Configuration with automatic cleanup
      const autoCleanupConfig = { ...config, emergencyCleanup: true };
      limiter = new ModelMemoryLimiter(autoCleanupConfig);
      await limiter.initialize();
      
      // Load models to trigger cleanup
      const models = Array.from({ length: 5 }, (_, i) => ({
        modelId: `model-${i}`,
        dimension: 384,
        estimatedMemoryMB: 110
      }));
      
      // When: Loading models that exceed limit
      const results = await Promise.all(
        models.map(model => limiter.loadModel(model))
      );
      
      // Then: Some loads should trigger cleanup
      const stats = limiter.getMemoryStats();
      expect(stats.currentMemoryMB).toBeLessThanOrEqual(config.maxMemoryMB);
      
      // Should have cleanup events
      const cleanupEvents = limiter.getCleanupHistory();
      expect(cleanupEvents.length).toBeGreaterThan(0);
    });
  });

  describe('configuration', () => {
    it('should validate configuration on creation', () => {
      // Given: Invalid configuration
      const invalidConfig = {
        maxMemoryMB: -100,
        fallbackModels: [],
        monitoringInterval: -1000
      };
      
      // When/Then: Should throw validation error
      expect(() => new ModelMemoryLimiter(invalidConfig as any)).toThrow("Invalid configuration");
    });

    it('should use default fallback models when none provided', async () => {
      // Given: Config without fallback models
      const configWithoutFallbacks = { ...config };
      delete (configWithoutFallbacks as any).fallbackModels;
      
      limiter = new ModelMemoryLimiter(configWithoutFallbacks);
      await limiter.initialize();
      
      // When: Loading model that needs fallback
      const result = await limiter.loadModel({
        modelId: "huge-model",
        dimension: 2048,
        estimatedMemoryMB: 1000
      });
      
      // Then: Should use default fallbacks
      expect(result.fallbackUsed).toBe(true);
      expect(result.modelId).toBe("Xenova/all-MiniLM-L6-v2"); // Default fallback
    });

    it('should respect custom monitoring interval', async () => {
      // Given: Custom monitoring interval
      const customConfig = { ...config, monitoringInterval: 500 };
      limiter = new ModelMemoryLimiter(customConfig);
      
      // When: Initializing
      await limiter.initialize();
      
      // Then: Should use custom interval
      const stats = limiter.getMemoryStats();
      expect(stats.monitoringIntervalMs).toBe(500);
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      limiter = new ModelMemoryLimiter(config);
      await limiter.initialize();
    });

    it('should handle model loading failures gracefully', async () => {
      // Given: Model that will fail to load
      const invalidModel: ModelConfig = {
        modelId: "invalid/nonexistent-model",
        dimension: 384,
        estimatedMemoryMB: 100
      };
      
      // When: Loading invalid model
      const result = await limiter.loadModel(invalidModel);
      
      // Then: Should handle failure gracefully
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.fallbackUsed).toBe(true); // Should try fallbacks
      
      const stats = limiter.getMemoryStats();
      expect(stats.modelsLoaded).toBeGreaterThanOrEqual(0); // Should remain consistent
    });

    it('should recover from memory monitoring failures', async () => {
      // Given: Monitoring active
      expect(limiter.isMonitoringActive()).toBe(true);
      
      // When: Simulating monitoring failure
      limiter.simulateMonitoringFailure();
      
      // Then: Should attempt recovery
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(limiter.isMonitoringActive()).toBe(true); // Should restart
      
      const stats = limiter.getMemoryStats();
      expect(stats.monitoringErrors).toBeGreaterThan(0);
    });

    it('should handle concurrent access safely', async () => {
      // Given: Multiple concurrent operations
      const operations = [
        limiter.loadModel({ modelId: "model-1", dimension: 384, estimatedMemoryMB: 100 }),
        limiter.loadModel({ modelId: "model-2", dimension: 384, estimatedMemoryMB: 100 }),
        limiter.getMemoryStats(),
        limiter.unloadModel("non-existent"),
        limiter.emergencyCleanup()
      ];
      
      // When: Running operations concurrently
      const results = await Promise.allSettled(operations);
      
      // Then: Should handle all operations without crashing
      expect(results.length).toBe(5);
      
      const stats = limiter.getMemoryStats();
      expect(stats).toBeDefined();
      expect(stats.currentMemoryMB).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resource cleanup', () => {
    beforeEach(async () => {
      limiter = new ModelMemoryLimiter(config);
      await limiter.initialize();
    });

    it('should clean up all resources on close', async () => {
      // Given: Models loaded and monitoring active
      await limiter.loadModel({
        modelId: "test-model",
        dimension: 384,
        estimatedMemoryMB: 100
      });
      
      expect(limiter.isMonitoringActive()).toBe(true);
      expect(limiter.getMemoryStats().modelsLoaded).toBe(1);
      
      // When: Closing limiter
      await limiter.close();
      
      // Then: All resources should be cleaned up
      expect(limiter.isInitialized()).toBe(false);
      expect(limiter.isMonitoringActive()).toBe(false);
      expect(() => limiter.getMemoryStats()).toThrow();
    });

    it('should handle cleanup errors gracefully', async () => {
      // Given: Limiter with loaded models
      await limiter.loadModel({
        modelId: "test-model",
        dimension: 384,
        estimatedMemoryMB: 100
      });
      
      // When: Closing with simulated cleanup failure
      limiter.simulateCleanupFailure();
      
      // Then: Should not throw but should log errors
      await expect(limiter.close()).resolves.not.toThrow();
      expect(limiter.isInitialized()).toBe(false);
    });

    it('should be safe to call close multiple times', async () => {
      // Given: Initialized limiter
      expect(limiter.isInitialized()).toBe(true);
      
      // When: Calling close multiple times
      await limiter.close();
      await limiter.close();
      await limiter.close();
      
      // Then: Should not throw errors
      expect(limiter.isInitialized()).toBe(false);
    });
  });

  describe('performance monitoring', () => {
    beforeEach(async () => {
      limiter = new ModelMemoryLimiter(config);
      await limiter.initialize();
    });

    it('should track model loading performance', async () => {
      // Given: Model to load
      const modelConfig: ModelConfig = {
        modelId: "test-model",
        dimension: 384,
        estimatedMemoryMB: 100
      };
      
      // When: Loading model
      const result = await limiter.loadModel(modelConfig);
      
      // Then: Should track performance metrics
      expect(result.loadTimeMs).toBeGreaterThan(0);
      expect(result.success).toBe(true);
      
      const performanceMetrics = limiter.getPerformanceMetrics();
      expect(performanceMetrics.totalLoads).toBe(1);
      expect(performanceMetrics.averageLoadTimeMs).toBeGreaterThan(0);
      expect(performanceMetrics.successRate).toBe(1.0);
    });

    it('should track memory utilization over time', async () => {
      // Given: Initial state
      const initialMetrics = limiter.getPerformanceMetrics();
      
      // When: Loading and unloading models
      const result1 = await limiter.loadModel({
        modelId: "model-1",
        dimension: 384,
        estimatedMemoryMB: 100
      });
      
      const result2 = await limiter.loadModel({
        modelId: "model-2",
        dimension: 384,
        estimatedMemoryMB: 150
      });
      
      await limiter.unloadModel("model-1");
      
      // Then: Should track utilization history
      const finalMetrics = limiter.getPerformanceMetrics();
      expect(finalMetrics.totalLoads).toBe(initialMetrics.totalLoads + 2);
      expect(finalMetrics.totalUnloads).toBe(initialMetrics.totalUnloads + 1);
      expect(finalMetrics.peakMemoryMB).toBeGreaterThan(0);
      
      const utilizationHistory = limiter.getMemoryUtilizationHistory();
      expect(utilizationHistory.length).toBeGreaterThan(0);
      expect(utilizationHistory[0].timestamp).toBeDefined();
      expect(utilizationHistory[0].utilizationPercent).toBeGreaterThanOrEqual(0);
    });
  });
});