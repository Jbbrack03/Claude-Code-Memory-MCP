/**
 * Cache level interface for external cache implementations
 */
export interface CacheLevel<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
  size(): Promise<number>;
  keys(): Promise<string[]>;
}

/**
 * Cache configuration options
 */
export interface CacheOptions {
  /** Maximum size of L1 cache (in-memory) */
  l1MaxSize: number;
  /** Optional L2 cache implementation */
  l2Cache?: CacheLevel<unknown>;
  /** Optional L3 cache implementation */
  l3Cache?: CacheLevel<unknown>;
  /** Default TTL in milliseconds */
  defaultTTL?: number;
  /** Custom eviction policy function */
  evictionPolicy?: <T>(cache: Map<string, CacheEntry<T>>) => string;
  /** Serializer for complex types */
  serializer?: (value: unknown) => string;
  /** Deserializer for complex types */
  deserializer?: (value: string) => unknown;
  /** Compression function */
  compress?: (value: string) => string;
  /** Decompression function */
  decompress?: (value: string) => string;
  /** Compression threshold in bytes */
  compressionThreshold?: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  l3Hits: number;
  l3Misses: number;
}

interface CacheEntry<T> {
  value: T;
  expiry?: number;
}

/**
 * Multi-level cache with LRU eviction and TTL support
 */
export class MultiLevelCache<T> {
  private readonly _l1Cache: Map<string, CacheEntry<T>>;
  private readonly _accessOrder: string[];
  private readonly _options: CacheOptions;
  private readonly _expiryTimers: Map<string, NodeJS.Timeout>;
  private readonly _promotionLocks: Map<string, Promise<T | undefined>>;
  private _stats: CacheStats;

  constructor(options: CacheOptions) {
    this._options = options;
    this._l1Cache = new Map();
    this._accessOrder = [];
    this._expiryTimers = new Map();
    this._promotionLocks = new Map();
    this._stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      l3Hits: 0,
      l3Misses: 0
    };
  }

  async get(key: string): Promise<T | undefined> {
    // Check L1 cache
    const l1Entry = this._l1Cache.get(key);
    if (l1Entry) {
      // Check if expired
      if (l1Entry.expiry && Date.now() > l1Entry.expiry) {
        this._removeFromL1(key);
      } else {
        this._updateAccessOrder(key);
        this._stats.hits++;
        this._stats.l1Hits++;
        this._updateHitRate();
        return l1Entry.value;
      }
    }

    this._stats.l1Misses++;

    // Check if there's already a promotion in progress for this key
    const existingPromotion = this._promotionLocks.get(key);
    if (existingPromotion) {
      const result = await existingPromotion;
      if (result !== undefined) {
        this._stats.hits++;
        this._updateHitRate();
      } else {
        this._stats.misses++;
        this._updateHitRate();
      }
      return result;
    }

    // Start promotion process
    const promotionPromise = this._promoteFromLowerLevels(key);
    this._promotionLocks.set(key, promotionPromise);
    
    try {
      const result = await promotionPromise;
      if (result !== undefined) {
        this._stats.hits++;
      } else {
        this._stats.misses++;
      }
      this._updateHitRate();
      return result;
    } finally {
      this._promotionLocks.delete(key);
    }
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    const effectiveTTL = ttl ?? this._options.defaultTTL;
    
    // Set in L1 cache
    if (this._options.l1MaxSize > 0) {
      this._setInL1(key, value, effectiveTTL);
    }

    // Write through to lower levels
    const promises: Promise<void>[] = [];
    
    if (this._options.l2Cache) {
      promises.push(
        this._options.l2Cache.set(key, value, effectiveTTL)
          .catch(() => { /* Ignore L2 errors */ })
      );
    }

    if (this._options.l3Cache) {
      promises.push(
        this._options.l3Cache.set(key, value, effectiveTTL)
          .catch(() => { /* Ignore L3 errors */ })
      );
    }

    await Promise.all(promises);
  }

  async delete(key: string): Promise<void> {
    this._removeFromL1(key);

    const promises: Promise<void>[] = [];
    
    if (this._options.l2Cache) {
      promises.push(
        this._options.l2Cache.delete(key)
          .catch(() => { /* Ignore L2 errors */ })
      );
    }

    if (this._options.l3Cache) {
      promises.push(
        this._options.l3Cache.delete(key)
          .catch(() => { /* Ignore L3 errors */ })
      );
    }

    await Promise.all(promises);
  }

  async clear(): Promise<void> {
    // Clear L1
    this._l1Cache.clear();
    this._accessOrder.length = 0;
    this._expiryTimers.forEach(timer => clearTimeout(timer));
    this._expiryTimers.clear();

    const promises: Promise<void>[] = [];
    
    if (this._options.l2Cache) {
      promises.push(
        this._options.l2Cache.clear()
          .catch(() => { /* Ignore L2 errors */ })
      );
    }

    if (this._options.l3Cache) {
      promises.push(
        this._options.l3Cache.clear()
          .catch(() => { /* Ignore L3 errors */ })
      );
    }

    await Promise.all(promises);
  }

  async has(key: string): Promise<boolean> {
    const l1Entry = this._l1Cache.get(key);
    if (l1Entry) {
      if (l1Entry.expiry && Date.now() > l1Entry.expiry) {
        this._removeFromL1(key);
        return false;
      }
      return true;
    }

    if (this._options.l2Cache) {
      try {
        const has = await this._options.l2Cache.has(key);
        if (has) return true;
      } catch { /* Ignore L2 errors */ }
    }

    if (this._options.l3Cache) {
      try {
        return await this._options.l3Cache.has(key);
      } catch { /* Ignore L3 errors */ }
    }

    return false;
  }

  async invalidate(key: string): Promise<void> {
    await this.delete(key);
  }

  async invalidatePattern(pattern: string | RegExp): Promise<void> {
    // Convert glob pattern to regex if it's a string
    const regex = typeof pattern === 'string' 
      ? new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      : pattern;

    // Invalidate from L1
    const l1Keys = Array.from(this._l1Cache.keys());
    for (const key of l1Keys) {
      if (regex.test(key)) {
        this._removeFromL1(key);
      }
    }

    // Invalidate from lower levels
    const promises: Promise<void>[] = [];

    if (this._options.l2Cache) {
      const l2Cache = this._options.l2Cache;
      promises.push(
        l2Cache.keys()
          .then(keys => {
            const deletePromises = keys
              .filter(key => regex.test(key))
              .map(key => l2Cache.delete(key).catch(() => {}));
            return Promise.all(deletePromises);
          })
          .catch(() => { /* Ignore L2 errors */ })
          .then(() => {})
      );
    }

    if (this._options.l3Cache) {
      const l3Cache = this._options.l3Cache;
      promises.push(
        l3Cache.keys()
          .then(keys => {
            const deletePromises = keys
              .filter(key => regex.test(key))
              .map(key => l3Cache.delete(key).catch(() => {}));
            return Promise.all(deletePromises);
          })
          .catch(() => { /* Ignore L3 errors */ })
          .then(() => {})
      );
    }

    await Promise.all(promises);
  }

  getStats(): CacheStats {
    return { ...this._stats };
  }

  resetStats(): void {
    this._stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      l3Hits: 0,
      l3Misses: 0
    };
  }

  private _setInL1(key: string, value: T, ttl?: number): void {
    // Clear existing timer if any
    const existingTimer = this._expiryTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this._expiryTimers.delete(key);
    }

    // Check if we need to evict
    if (!this._l1Cache.has(key) && this._l1Cache.size >= this._options.l1MaxSize) {
      this._evictFromL1();
    }

    // Set the entry
    const entry: CacheEntry<T> = { value };
    if (ttl) {
      entry.expiry = Date.now() + ttl;
      const timer = setTimeout(() => {
        this._removeFromL1(key);
      }, ttl);
      this._expiryTimers.set(key, timer);
    }

    this._l1Cache.set(key, entry);
    this._updateAccessOrder(key);
  }

  private _removeFromL1(key: string): void {
    this._l1Cache.delete(key);
    const index = this._accessOrder.indexOf(key);
    if (index !== -1) {
      this._accessOrder.splice(index, 1);
    }
    
    const timer = this._expiryTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this._expiryTimers.delete(key);
    }
  }

  private _updateAccessOrder(key: string): void {
    const index = this._accessOrder.indexOf(key);
    if (index !== -1) {
      this._accessOrder.splice(index, 1);
    }
    this._accessOrder.push(key);
  }

  private _evictFromL1(): void {
    if (this._options.evictionPolicy) {
      const keyToEvict = this._options.evictionPolicy(this._l1Cache);
      if (keyToEvict) {
        this._removeFromL1(keyToEvict);
      }
    } else {
      // Default LRU eviction
      if (this._accessOrder.length > 0) {
        const lruKey = this._accessOrder[0];
        if (lruKey) {
          this._removeFromL1(lruKey);
        }
      }
    }
  }

  private async _promoteFromLowerLevels(key: string): Promise<T | undefined> {
    // Check L2
    if (this._options.l2Cache) {
      try {
        const l2Value = await this._options.l2Cache.get(key);
        if (l2Value !== undefined) {
          this._stats.l2Hits++;
          // Promote to L1
          if (this._options.l1MaxSize > 0) {
            this._setInL1(key, l2Value as T, this._options.defaultTTL);
          }
          return l2Value as T;
        }
      } catch { /* Ignore L2 errors */ }
      this._stats.l2Misses++;
    }

    // Check L3
    if (this._options.l3Cache) {
      try {
        const l3Value = await this._options.l3Cache.get(key);
        if (l3Value !== undefined) {
          this._stats.l3Hits++;
          
          // Promote to L2 and L1
          const promises: Promise<void>[] = [];
          
          if (this._options.l2Cache) {
            promises.push(
              this._options.l2Cache.set(key, l3Value, this._options.defaultTTL)
                .catch(() => { /* Ignore L2 errors */ })
            );
          }
          
          if (this._options.l1MaxSize > 0) {
            this._setInL1(key, l3Value as T, this._options.defaultTTL);
          }
          
          await Promise.all(promises);
          return l3Value as T;
        }
      } catch { /* Ignore L3 errors */ }
      this._stats.l3Misses++;
    }

    return undefined;
  }

  private _updateHitRate(): void {
    const total = this._stats.hits + this._stats.misses;
    this._stats.hitRate = total > 0 ? this._stats.hits / total : 0;
  }
}