
/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  /** Maximum number of requests allowed in window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Key prefix for namespacing (e.g., 'memory-capture', 'context-retrieval') */
  keyPrefix?: string;
  /** Whether to use sliding window (true) or fixed window (false) */
  slidingWindow?: boolean;
  /** TTL for rate limit records in milliseconds */
  ttl?: number;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of requests remaining in window */
  remaining: number;
  /** Time until reset in milliseconds */
  resetAfter: number;
  /** Total limit */
  limit: number;
  /** Retry after in seconds (for 429 responses) */
  retryAfter?: number;
}

interface WindowEntry {
  timestamps: number[];
  windowStart?: number;
  count: number;
  lastAccess: number;
}

/**
 * Rate limiter with sliding window support
 */
export class RateLimiter {
  private readonly _config: Required<RateLimiterConfig>;
  private readonly _store: Map<string, WindowEntry>;

  constructor(config: RateLimiterConfig) {
    // Validate configuration
    if (config.maxRequests <= 0) {
      throw new Error("maxRequests must be greater than 0");
    }
    if (config.windowMs <= 0) {
      throw new Error("windowMs must be greater than 0");
    }

    this._config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      keyPrefix: config.keyPrefix || 'rate-limit',
      slidingWindow: config.slidingWindow ?? true,
      ttl: config.ttl || config.windowMs * 2
    };
    this._store = new Map();
  }

  /**
   * Check if request is allowed and update counters
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async checkLimit(key: string): Promise<RateLimitResult> {
    if (!key) {
      throw new Error("Key is required");
    }

    const fullKey = this._config.keyPrefix ? `${this._config.keyPrefix}:${key}` : key;
    const now = Date.now();

    if (this._config.slidingWindow) {
      return this._checkSlidingWindow(fullKey, now);
    } else {
      return this._checkFixedWindow(fullKey, now);
    }
  }

  private _checkSlidingWindow(key: string, now: number): RateLimitResult {
    let entry = this._store.get(key);
    
    if (!entry) {
      entry = { timestamps: [], count: 0, lastAccess: now };
      this._store.set(key, entry);
    }

    // Remove timestamps outside the window
    const windowStart = now - this._config.windowMs;
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);
    entry.lastAccess = now;
    entry.count = entry.timestamps.length;

    if (entry.count < this._config.maxRequests) {
      // Request allowed
      entry.timestamps.push(now);
      entry.count++;
      const remaining = this._config.maxRequests - entry.count;
      const oldestTimestamp = entry.timestamps[0] || now;
      const resetAfter = Math.max(0, oldestTimestamp + this._config.windowMs - now);
      
      return {
        allowed: true,
        remaining,
        resetAfter,
        limit: this._config.maxRequests
      };
    } else {
      // Request blocked
      const oldestTimestamp = entry.timestamps[0] || now;
      const resetAfter = Math.max(0, oldestTimestamp + this._config.windowMs - now);
      const retryAfter = Math.ceil(resetAfter / 1000);
      
      return {
        allowed: false,
        remaining: 0,
        resetAfter,
        limit: this._config.maxRequests,
        retryAfter
      };
    }
  }

  private _checkFixedWindow(key: string, now: number): RateLimitResult {
    let entry = this._store.get(key);
    const windowStart = Math.floor(now / this._config.windowMs) * this._config.windowMs;
    
    if (!entry || entry.windowStart !== windowStart) {
      // New window
      entry = { 
        timestamps: [],
        windowStart, 
        count: 0, 
        lastAccess: now 
      };
      this._store.set(key, entry);
    }

    entry.lastAccess = now;
    
    if (entry.count < this._config.maxRequests) {
      // Request allowed
      entry.count++;
      const remaining = this._config.maxRequests - entry.count;
      const resetAfter = windowStart + this._config.windowMs - now;
      
      return {
        allowed: true,
        remaining,
        resetAfter,
        limit: this._config.maxRequests
      };
    } else {
      // Request blocked
      const resetAfter = windowStart + this._config.windowMs - now;
      const retryAfter = Math.ceil(resetAfter / 1000);
      
      return {
        allowed: false,
        remaining: 0,
        resetAfter,
        limit: this._config.maxRequests,
        retryAfter
      };
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async reset(key: string): Promise<void> {
    if (!key) {
      throw new Error("Key is required");
    }

    const fullKey = this._config.keyPrefix ? `${this._config.keyPrefix}:${key}` : key;
    this._store.delete(fullKey);
  }

  /**
   * Get current state without incrementing
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async getState(key: string): Promise<RateLimitResult> {
    if (!key) {
      throw new Error("Key is required");
    }

    const fullKey = this._config.keyPrefix ? `${this._config.keyPrefix}:${key}` : key;
    const now = Date.now();
    const entry = this._store.get(fullKey);

    if (!entry) {
      // No entry exists, return full limit available
      return {
        allowed: true,
        remaining: this._config.maxRequests,
        resetAfter: 0,
        limit: this._config.maxRequests
      };
    }

    if (this._config.slidingWindow) {
      // Calculate current state for sliding window
      const windowStart = now - this._config.windowMs;
      const validTimestamps = entry.timestamps.filter(ts => ts > windowStart);
      const count = validTimestamps.length;
      const remaining = Math.max(0, this._config.maxRequests - count);
      const oldestTimestamp = validTimestamps[0] || now;
      const resetAfter = Math.max(0, oldestTimestamp + this._config.windowMs - now);
      
      return {
        allowed: count < this._config.maxRequests,
        remaining,
        resetAfter,
        limit: this._config.maxRequests
      };
    } else {
      // Calculate current state for fixed window
      const windowStart = Math.floor(now / this._config.windowMs) * this._config.windowMs;
      
      if (entry.windowStart !== windowStart) {
        // Window has expired
        return {
          allowed: true,
          remaining: this._config.maxRequests,
          resetAfter: 0,
          limit: this._config.maxRequests
        };
      }
      
      const count = entry.count || 0;
      const remaining = Math.max(0, this._config.maxRequests - count);
      const resetAfter = windowStart + this._config.windowMs - now;
      
      return {
        allowed: count < this._config.maxRequests,
        remaining,
        resetAfter,
        limit: this._config.maxRequests
      };
    }
  }

  /**
   * Clean up expired entries
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async cleanup(): Promise<number> {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this._store.entries()) {
      if (now - entry.lastAccess > this._config.ttl) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this._store.delete(key);
    }

    return expiredKeys.length;
  }

  /**
   * Clear all rate limit data
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async clear(): Promise<void> {
    this._store.clear();
  }
}