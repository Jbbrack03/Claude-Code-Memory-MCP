import { EventEmitter } from 'events';

interface MemoryUsage {
  heapUsedMB: number;
  heapTotalMB: number;
  heapUsedPercent: number;
  rssMB: number;
  externalMB: number;
  arrayBuffersMB: number;
}

interface CleanupHandler {
  name: string;
  handler: () => void | Promise<void>;
  priority: number;
  level: 'low' | 'medium' | 'high';
}

interface MonitoringConfig {
  checkInterval?: number;
  thresholds?: {
    low: number;
    medium: number;
    high: number;
  };
  enableGC?: boolean;
  trackHistory?: boolean;
  historySize?: number;
  analyzeTrends?: boolean;
  enableDegradation?: boolean;
  degradationStrategy?: (level: string) => string[];
}

interface HistoryEntry extends MemoryUsage {
  timestamp: number;
}

export class MemoryManager extends EventEmitter {
  private static instance: MemoryManager;
  private intervalId: NodeJS.Timeout | null = null;
  private handlers: Map<string, CleanupHandler> = new Map();
  private currentPressureLevel: 'normal' | 'low' | 'medium' | 'high' = 'normal';
  private config: Required<MonitoringConfig> = {
    checkInterval: 1000,
    thresholds: {
      low: 0.6,
      medium: 0.8,
      high: 0.9
    },
    enableGC: false,
    trackHistory: false,
    historySize: 100,
    analyzeTrends: false,
    enableDegradation: false,
    degradationStrategy: this.defaultDegradationStrategy.bind(this)
  };
  private history: HistoryEntry[] = [];

  private constructor() {
    super();
  }

  static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  startMonitoring(config?: MonitoringConfig): void {
    if (this.intervalId) {
      return;
    }

    if (config) {
      this.validateConfig(config);
      this.config = { ...this.config, ...config };
    }

    // Initial check
    this.check();
    
    this.intervalId = setInterval(() => this.check(), this.config.checkInterval);
  }

  stopMonitoring(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  registerHandler(
    name: string, 
    handler: () => void | Promise<void>, 
    options: { priority?: number; level?: 'low' | 'medium' | 'high' } = {}
  ): void {
    this.handlers.set(name, {
      name,
      handler,
      priority: options.priority || 1,
      level: options.level || 'low'
    });
  }

  unregisterHandler(name: string): void {
    this.handlers.delete(name);
  }

  clearHandlers(): void {
    this.handlers.clear();
  }

  getHandlers(): CleanupHandler[] {
    return Array.from(this.handlers.values());
  }

  getStatistics(): {
    current: MemoryUsage;
    thresholds: { low: number; medium: number; high: number };
    pressure: 'normal' | 'low' | 'medium' | 'high';
    handlersRegistered: number;
    monitoring: boolean;
    history?: HistoryEntry[];
    trend?: 'increasing' | 'decreasing' | 'stable';
  } {
    const current = this.getMemoryUsage();
    // Determine current pressure level based on current memory usage
    const currentPressure = this.determinePressureLevel(current.heapUsedPercent);
    return {
      current,
      thresholds: this.config.thresholds,
      pressure: currentPressure,
      handlersRegistered: this.handlers.size,
      monitoring: !!this.intervalId,
      ...(this.config.trackHistory && { history: this.history }),
      ...(this.config.analyzeTrends && { trend: this.analyzeTrend() })
    };
  }

  private check(): void {
    try {
      const usage = this.getMemoryUsage();
      
      if (this.config.trackHistory) {
        this.updateHistory(usage);
      }

      const newPressureLevel = this.determinePressureLevel(usage.heapUsedPercent);
      
      if (newPressureLevel !== this.currentPressureLevel) {
        this.currentPressureLevel = newPressureLevel;
        this.emit('memoryPressure', {
          level: newPressureLevel,
          usage
        });

        if (newPressureLevel !== 'normal') {
          this.executeHandlers(newPressureLevel);
          
          if (this.config.enableGC && typeof (global as { gc?: () => void }).gc === 'function') {
            (global as { gc?: () => void }).gc?.();
          }

          if (this.config.enableDegradation) {
            const suggestions = this.config.degradationStrategy(newPressureLevel);
            this.emit('degradation', {
              level: newPressureLevel,
              suggestions
            });
          }
        }
      }
    } catch (error) {
      this.emit('error', {
        error,
        context: 'monitoring'
      });
    }
  }

  private getMemoryUsage(): MemoryUsage {
    const mem = process.memoryUsage();
    if (!mem || typeof mem.heapUsed === 'undefined') {
      // Fallback for mocked or missing memory data
      return {
        heapUsedMB: 0,
        heapTotalMB: 0,
        heapUsedPercent: 0,
        rssMB: 0,
        externalMB: 0,
        arrayBuffersMB: 0
      };
    }
    return {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      heapUsedPercent: (mem.heapUsed / mem.heapTotal) * 100,
      rssMB: Math.round(mem.rss / 1024 / 1024),
      externalMB: Math.round(mem.external / 1024 / 1024),
      arrayBuffersMB: Math.round(mem.arrayBuffers / 1024 / 1024)
    };
  }

  private determinePressureLevel(heapUsedPercent: number): 'normal' | 'low' | 'medium' | 'high' {
    const { thresholds } = this.config;
    if (heapUsedPercent >= thresholds.high * 100) return 'high';
    if (heapUsedPercent >= thresholds.medium * 100) return 'medium';
    if (heapUsedPercent >= thresholds.low * 100) return 'low';
    return 'normal';
  }

  private executeHandlers(level: 'low' | 'medium' | 'high'): void {
    const handlersToExecute = Array.from(this.handlers.values())
      .filter(h => {
        if (level === 'high') return true;
        if (level === 'medium') return h.level === 'low' || h.level === 'medium';
        if (level === 'low') return h.level === 'low';
        return false;
      })
      .sort((a, b) => b.priority - a.priority);

    for (const handler of handlersToExecute) {
      try {
        void handler.handler();
      } catch (error) {
        this.emit('error', {
          error,
          handler: handler.name
        });
      }
    }
  }

  private updateHistory(usage: MemoryUsage): void {
    this.history.push({
      ...usage,
      timestamp: Date.now()
    });

    if (this.history.length > this.config.historySize) {
      this.history.shift();
    }
  }

  private analyzeTrend(): 'increasing' | 'decreasing' | 'stable' {
    if (this.history.length < 2) return 'stable';

    const recent = this.history.slice(-5);
    let increasing = 0;
    let decreasing = 0;

    for (let i = 1; i < recent.length; i++) {
      const current = recent[i];
      const previous = recent[i - 1];
      if (current && previous) {
        if (current.heapUsedMB > previous.heapUsedMB) {
          increasing++;
        } else if (current.heapUsedMB < previous.heapUsedMB) {
          decreasing++;
        }
      }
    }

    if (increasing > decreasing) return 'increasing';
    if (decreasing > increasing) return 'decreasing';
    return 'stable';
  }

  private defaultDegradationStrategy(level: string): string[] {
    switch (level) {
      case 'low':
        return ['reduce-cache-ttl', 'limit-concurrent-operations'];
      case 'medium':
        return ['disable-non-essential-features', 'reduce-batch-sizes'];
      case 'high':
        return ['disable-caching', 'reduce-batch-sizes', 'pause-background-tasks'];
      default:
        return [];
    }
  }

  private validateConfig(config: MonitoringConfig): void {
    if (config.checkInterval !== undefined) {
      if (config.checkInterval <= 0 || isNaN(config.checkInterval)) {
        throw new Error('Check interval must be a positive number');
      }
    }

    if (config.thresholds) {
      const { low, medium, high } = config.thresholds;
      if (low < 0 || low > 1 || medium < 0 || medium > 1 || high < 0 || high > 1) {
        throw new Error('Thresholds must be between 0 and 1');
      }
      if (low >= medium || medium >= high) {
        throw new Error('Thresholds must be in ascending order: low < medium < high');
      }
    }
  }
}