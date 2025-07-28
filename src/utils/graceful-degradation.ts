import { createLogger } from "./logger.js";

const logger = createLogger("GracefulDegradation");

export enum DegradationLevel {
  NONE = "none",
  PARTIAL = "partial", 
  SEVERE = "severe",
  EMERGENCY = "emergency"
}

export interface DegradationState {
  level: DegradationLevel;
  disabledFeatures: string[];
  reason: string;
  timestamp: Date;
}

export class GracefulDegradation {
  private static currentState: DegradationState = {
    level: DegradationLevel.NONE,
    disabledFeatures: [],
    reason: "Normal operation",
    timestamp: new Date()
  };

  private static listeners: Array<(state: DegradationState) => void> = [];

  /**
   * Get current degradation state
   */
  static getCurrentState(): DegradationState {
    return { ...this.currentState };
  }

  /**
   * Subscribe to degradation state changes
   */
  static onStateChange(callback: (state: DegradationState) => void): void {
    this.listeners.push(callback);
  }

  /**
   * Handle storage failure - switch to read-only mode
   */
  static async handleStorageFailure(error: Error): Promise<void> {
    logger.warn("Storage failure detected, entering degraded mode", { error: error.message });
    
    const newState: DegradationState = {
      level: DegradationLevel.PARTIAL,
      disabledFeatures: ['memory_capture', 'memory_storage'],
      reason: `Storage failure: ${error.message}`,
      timestamp: new Date()
    };

    this.updateState(newState);
    
    // Could implement read-only fallback here
    // - Use in-memory cache for recent memories
    // - Disable new memory captures
    // - Return cached/static responses
  }

  /**
   * Handle intelligence layer failure - fall back to simple search
   */
  static async handleIntelligenceFailure(error: Error): Promise<void> {
    logger.warn("Intelligence layer failure, disabling semantic features", { error: error.message });
    
    const newState: DegradationState = {
      level: DegradationLevel.PARTIAL,
      disabledFeatures: ['semantic_search', 'embeddings', 'context_building'],
      reason: `Intelligence failure: ${error.message}`,
      timestamp: new Date()
    };

    this.updateState(newState);
    
    // Could implement fallback search here
    // - Simple text matching instead of semantic search
    // - Basic memory listing instead of intelligent retrieval
    // - Static context instead of dynamic building
  }

  /**
   * Handle hook system failure - disable hook execution
   */
  static async handleHookFailure(error: Error): Promise<void> {
    logger.warn("Hook system failure, disabling hook execution", { error: error.message });
    
    const newState: DegradationState = {
      level: DegradationLevel.PARTIAL,
      disabledFeatures: ['hook_execution', 'event_processing'],
      reason: `Hook failure: ${error.message}`,
      timestamp: new Date()
    };

    this.updateState(newState);
    
    // Hook failures are non-critical
    // - Continue normal operation without hooks
    // - Log events but don't process them
  }

  /**
   * Handle git integration failure - disable git features
   */
  static async handleGitFailure(error: Error): Promise<void> {
    logger.warn("Git integration failure, disabling git features", { error: error.message });
    
    const newState: DegradationState = {
      level: DegradationLevel.PARTIAL,
      disabledFeatures: ['git_validation', 'branch_isolation'],
      reason: `Git failure: ${error.message}`,
      timestamp: new Date()
    };

    this.updateState(newState);
    
    // Git failures are non-critical
    // - Continue memory operations without git context
    // - Skip git validation
    // - Use default workspace isolation
  }

  /**
   * Handle multiple system failures - enter emergency mode
   */
  static async handleMultipleFailures(errors: Error[]): Promise<void> {
    logger.error("Multiple system failures detected, entering emergency mode", { 
      errorCount: errors.length,
      errors: errors.map(e => e.message)
    });
    
    const newState: DegradationState = {
      level: DegradationLevel.EMERGENCY,
      disabledFeatures: [
        'memory_capture', 
        'semantic_search', 
        'hook_execution', 
        'git_validation',
        'embeddings',
        'context_building'
      ],
      reason: `Multiple failures: ${errors.map(e => e.message).join(', ')}`,
      timestamp: new Date()
    };

    this.updateState(newState);
    
    // Emergency mode - minimal functionality only
    // - Return static responses
    // - Disable all non-essential features
    // - Focus on keeping basic MCP protocol working
  }

  /**
   * Attempt to recover from degraded state
   */
  static async attemptRecovery(): Promise<boolean> {
    if (this.currentState.level === DegradationLevel.NONE) {
      return true; // Already healthy
    }

    logger.info("Attempting recovery from degraded state");
    
    try {
      // This would test each disabled feature to see if it's working again
      // For now, just reset to normal state as a placeholder
      const newState: DegradationState = {
        level: DegradationLevel.NONE,
        disabledFeatures: [],
        reason: "Recovery successful",
        timestamp: new Date()
      };

      this.updateState(newState);
      logger.info("Recovery successful");
      return true;
    } catch (error) {
      logger.error("Recovery failed", error);
      return false;
    }
  }

  /**
   * Check if a feature is currently disabled
   */
  static isFeatureDisabled(feature: string): boolean {
    return this.currentState.disabledFeatures.includes(feature);
  }

  /**
   * Get alternative action for disabled feature
   */
  static getAlternativeAction(feature: string): string | null {
    const alternatives: Record<string, string> = {
      'semantic_search': 'Use simple text search instead',
      'memory_capture': 'Memory capture temporarily unavailable',
      'hook_execution': 'Hook processing disabled',
      'git_validation': 'Git features unavailable',
      'embeddings': 'Semantic features disabled',
      'context_building': 'Static context provided'
    };

    return alternatives[feature] || null;
  }

  /**
   * Update degradation state and notify listeners
   */
  private static updateState(newState: DegradationState): void {
    const previousLevel = this.currentState.level;
    this.currentState = newState;
    
    // Log state change
    if (newState.level !== previousLevel) {
      logger.info("Degradation state changed", {
        from: previousLevel,
        to: newState.level,
        reason: newState.reason,
        disabledFeatures: newState.disabledFeatures
      });
    }

    // Notify listeners
    this.listeners.forEach(listener => {
      try {
        listener(newState);
      } catch (error) {
        logger.error("Error notifying degradation listener", error);
      }
    });
  }

  /**
   * Create a degradation-aware response for MCP tools
   */
  static createDegradedResponse(requestedFeature: string): {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  } {
    if (!this.isFeatureDisabled(requestedFeature)) {
      throw new Error("Feature is not disabled");
    }

    const alternative = this.getAlternativeAction(requestedFeature);
    const message = alternative || "Feature temporarily unavailable";

    return {
      content: [{
        type: "text",
        text: `${message}. System is in ${this.currentState.level} mode due to: ${this.currentState.reason}`
      }],
      isError: true
    };
  }
}