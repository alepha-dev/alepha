import { $inject } from "alepha";
import { DateTimeProvider, type Timeout } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { CacheProvider } from "./CacheProvider.ts";

type CacheName = string;
type CacheKey = string;
type CacheValue = {
  data?: Uint8Array;
  timeout?: Timeout;
};

// ---------------------------------------------------------------------------------------------------------------------

export interface MemoryCacheCall {
  name: string;
  key: string;
  timestamp: number;
}

export interface MemoryCacheSetCall extends MemoryCacheCall {
  value: Uint8Array;
  ttl?: number;
}

export interface MemoryCacheDelCall {
  name: string;
  keys: string[];
  timestamp: number;
}

export interface MemoryCacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
}

export interface MemoryCacheProviderOptions {
  /**
   * Error to throw on get operations (for testing error handling)
   */
  getError?: Error | null;
  /**
   * Error to throw on set operations (for testing error handling)
   */
  setError?: Error | null;
  /**
   * Error to throw on del operations (for testing error handling)
   */
  delError?: Error | null;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * In-memory implementation of CacheProvider for testing.
 *
 * This provider stores all cache entries in memory, making it ideal for
 * unit tests that need to verify cache operations without touching Redis or other backends.
 *
 * @example
 * ```typescript
 * // In tests, substitute the real CacheProvider with MemoryCacheProvider
 * const alepha = Alepha.create().with({
 *   provide: CacheProvider,
 *   use: MemoryCacheProvider,
 * });
 *
 * // Run code that uses caching
 * const service = alepha.inject(MyService);
 * await service.fetchWithCache("key");
 *
 * // Verify cache behavior
 * const cache = alepha.inject(MemoryCacheProvider);
 * expect(cache.stats().misses).toBe(1);
 * await service.fetchWithCache("key");
 * expect(cache.stats().hits).toBe(1);
 * ```
 */
export class MemoryCacheProvider extends CacheProvider {
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly log = $logger();

  protected store: Record<CacheName, Record<CacheKey, CacheValue>> = {};

  // ─────────────────────────────────────────────────────────────────────────────
  // Test tracking
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * All recorded get calls.
   */
  public getCalls: MemoryCacheCall[] = [];

  /**
   * All recorded set calls.
   */
  public setCalls: MemoryCacheSetCall[] = [];

  /**
   * All recorded del calls.
   */
  public delCalls: MemoryCacheDelCall[] = [];

  /**
   * Cache statistics.
   */
  protected _stats: MemoryCacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
  };

  /**
   * Error to throw on get (for testing error handling)
   */
  public getError: Error | null = null;

  /**
   * Error to throw on set (for testing error handling)
   */
  public setError: Error | null = null;

  /**
   * Error to throw on del (for testing error handling)
   */
  public delError: Error | null = null;

  constructor(options: MemoryCacheProviderOptions = {}) {
    super();
    this.getError = options.getError ?? null;
    this.setError = options.setError ?? null;
    this.delError = options.delError ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CacheProvider implementation
  // ─────────────────────────────────────────────────────────────────────────────

  public async get(name: string, key: string): Promise<Uint8Array | undefined> {
    this.getCalls.push({
      name,
      key,
      timestamp: this.dateTimeProvider.nowMillis(),
    });

    if (this.getError) {
      throw this.getError;
    }

    const data = this.store[name]?.[key]?.data;

    if (data !== undefined) {
      this._stats.hits++;
    } else {
      this._stats.misses++;
    }

    return data;
  }

  public async set(
    name: string,
    key: string,
    value: Uint8Array,
    ttl?: number,
  ): Promise<Uint8Array> {
    this.setCalls.push({
      name,
      key,
      value,
      ttl,
      timestamp: this.dateTimeProvider.nowMillis(),
    });
    this._stats.sets++;

    if (this.setError) {
      throw this.setError;
    }

    if (this.store[name] == null) {
      this.store[name] = {};
    }

    this.store[name][key] ??= {};
    this.store[name][key].data = value;

    this.log.debug(`Setting cache for name`, { name, key, ttl });

    // clear previous timeout if exists
    if (this.store[name][key].timeout) {
      this.dateTimeProvider.clearTimeout(this.store[name][key].timeout);
      this.store[name][key].timeout = undefined;
    }

    if (ttl) {
      this.store[name][key].timeout = this.dateTimeProvider.createTimeout(
        () => this.del(name, key),
        ttl,
      );
    }

    return this.store[name][key].data;
  }

  public async del(name: string, ...keys: string[]): Promise<void> {
    this.delCalls.push({
      name,
      keys,
      timestamp: this.dateTimeProvider.nowMillis(),
    });
    this._stats.deletes++;

    if (this.delError) {
      throw this.delError;
    }

    // delete all keys in name
    if (keys.length === 0) {
      this.log.debug(`Deleting all cache for name`, { name });

      if (this.store[name]) {
        for (const key of Object.keys(this.store[name])) {
          const timeout = this.store[name][key]?.timeout;
          if (timeout) {
            this.dateTimeProvider.clearTimeout(timeout);
          }
        }
      }
      delete this.store[name];
      return;
    }

    this.log.debug(`Deleting cache for name`, { name, keys });

    // delete specific keys in name
    for (const key of keys) {
      if (this.store[name] == null) break;

      const timeout = this.store[name][key]?.timeout;
      if (timeout) {
        this.dateTimeProvider.clearTimeout(timeout);
      }

      delete this.store[name][key];
    }

    if (Object.keys(this.store[name] ?? {}).length === 0) {
      // if name is empty, delete it
      delete this.store[name];
    }
  }

  public async has(name: string, key: string): Promise<boolean> {
    return this.store[name]?.[key]?.data != null;
  }

  public async keys(name: string, filter?: string): Promise<string[]> {
    const store = this.store[name] ?? {};
    const keys = Object.keys(store);
    if (filter) {
      return keys.filter((key) => key.startsWith(filter));
    }
    return keys;
  }

  public async clear(): Promise<void> {
    this.log.debug("Clearing all cache");

    // Clear all timeouts before clearing the store
    for (const name of Object.keys(this.store)) {
      for (const key of Object.keys(this.store[name])) {
        const timeout = this.store[name][key]?.timeout;
        if (timeout) {
          this.dateTimeProvider.clearTimeout(timeout);
        }
      }
    }

    this.store = {};
  }

  public async incr(
    name: string,
    key: string,
    amount: number,
    ttl?: number,
  ): Promise<number> {
    if (this.store[name] == null) {
      this.store[name] = {};
    }

    const existing = this.store[name][key]?.data;
    let current = 0;

    if (existing) {
      try {
        current = this.deserialize<number>(existing);
      } catch {
        // Fallback for raw bytes without type marker
        const str = new TextDecoder().decode(existing);
        current = Number.parseInt(str, 10) || 0;
      }
    }

    const newValue = current + amount;
    this.store[name][key] ??= {};
    this.store[name][key].data = this.serialize(newValue);

    // Fixed window: the ttl is armed when the counter is created and NOT
    // extended by subsequent increments.
    if (ttl && !existing) {
      const entry = this.store[name][key];
      if (entry.timeout) {
        this.dateTimeProvider.clearTimeout(entry.timeout);
      }
      entry.timeout = this.dateTimeProvider.createTimeout(() => {
        delete this.store[name][key];
      }, ttl);
    }

    return newValue;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Test utilities
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get cache statistics (hits, misses, sets, deletes).
   *
   * @example
   * ```typescript
   * expect(cache.stats().hits).toBe(1);
   * expect(cache.stats().misses).toBe(0);
   * ```
   */
  public stats(): MemoryCacheStats {
    return { ...this._stats };
  }

  /**
   * Check if a key was set during the test.
   *
   * @example
   * ```typescript
   * expect(cache.wasSet("my-cache", "user:123")).toBe(true);
   * ```
   */
  public wasSet(name: string, key?: string): boolean {
    if (key === undefined) {
      return this.setCalls.some((call) => call.name === name);
    }
    return this.setCalls.some((call) => call.name === name && call.key === key);
  }

  /**
   * Check if a key was retrieved during the test.
   *
   * @example
   * ```typescript
   * expect(cache.wasGet("my-cache", "user:123")).toBe(true);
   * ```
   */
  public wasGet(name: string, key?: string): boolean {
    if (key === undefined) {
      return this.getCalls.some((call) => call.name === name);
    }
    return this.getCalls.some((call) => call.name === name && call.key === key);
  }

  /**
   * Check if a key was deleted during the test.
   *
   * @example
   * ```typescript
   * expect(cache.wasDeleted("my-cache", "user:123")).toBe(true);
   * ```
   */
  public wasDeleted(name: string, key?: string): boolean {
    if (key === undefined) {
      return this.delCalls.some((call) => call.name === name);
    }
    return this.delCalls.some(
      (call) => call.name === name && call.keys.includes(key),
    );
  }

  /**
   * Get the number of cached entries for a specific cache name.
   *
   * @example
   * ```typescript
   * expect(cache.size("my-cache")).toBe(5);
   * ```
   */
  public size(name?: string): number {
    if (name === undefined) {
      return Object.values(this.store).reduce(
        (total, entries) => total + Object.keys(entries).length,
        0,
      );
    }
    return Object.keys(this.store[name] ?? {}).length;
  }

  /**
   * Get all cache names.
   *
   * @example
   * ```typescript
   * expect(cache.names()).toContain("my-cache");
   * ```
   */
  public names(): string[] {
    return Object.keys(this.store);
  }

  /**
   * Reset all in-memory state (useful between tests).
   *
   * @example
   * ```typescript
   * beforeEach(() => {
   *   cache.reset();
   * });
   * ```
   */
  public reset(): void {
    // Clear all timeouts
    for (const name of Object.keys(this.store)) {
      for (const key of Object.keys(this.store[name])) {
        const timeout = this.store[name][key]?.timeout;
        if (timeout) {
          this.dateTimeProvider.clearTimeout(timeout);
        }
      }
    }

    this.store = {};
    this.getCalls = [];
    this.setCalls = [];
    this.delCalls = [];
    this._stats = { hits: 0, misses: 0, sets: 0, deletes: 0 };
    this.getError = null;
    this.setError = null;
    this.delError = null;
  }
}
