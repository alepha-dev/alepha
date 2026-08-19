import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

/**
 * Database query cache using a simple in-memory Map.
 *
 * Uses `{tableName}:{cacheKey}` as the storage key.
 * Provides per-table invalidation for write-through cache busting.
 *
 * This is intentionally self-contained (no external cache dependencies)
 * so the ORM module does not force `AlephaCache` on all consumers.
 *
 * ### Bounded on purpose
 *
 * The key space is not: it is derived from the caller's query, so a query built
 * from user-controlled pagination or filter values mints a fresh entry per
 * distinct input. `expiresAt` was only ever consulted inside `get()`, so an
 * entry written once and never read again was reclaimed by nothing short of a
 * write to its table - never, for a read-mostly table. Two bounds close that:
 * expired entries are swept on write, and the map is capped at
 * {@link MAX_ENTRIES} with oldest-first eviction (insertion order).
 */
export class DbCacheProvider {
  /**
   * Hard cap on retained entries. Sized so an ordinary app never reaches it —
   * this is a leak backstop, not a tuning knob.
   */
  public static readonly MAX_ENTRIES = 5_000;

  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly store = new Map<
    string,
    { value: unknown; expiresAt?: number }
  >();

  protected storeKey(tableName: string, cacheKey: string): string {
    return `${tableName}:${cacheKey}`;
  }

  /**
   * Get a cached query result.
   */
  public async get<T>(
    tableName: string,
    cacheKey: string,
  ): Promise<T | undefined> {
    const key = this.storeKey(tableName, cacheKey);
    const entry = this.store.get(key);

    if (!entry) return undefined;
    if (entry.expiresAt && this.dateTime.nowMillis() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Store a query result in the cache.
   */
  public async set<T>(
    tableName: string,
    cacheKey: string,
    value: T,
    ttl?: number,
  ): Promise<void> {
    const key = this.storeKey(tableName, cacheKey);
    this.store.set(key, {
      value,
      expiresAt: ttl ? this.dateTime.nowMillis() + ttl : undefined,
    });
    this.evict();
  }

  /**
   * Reclaim space: drop everything already expired, then, if still over
   * budget, the oldest entries until the cap is met. `Map` preserves insertion
   * order, so `keys()` yields oldest-first.
   */
  protected evict(): void {
    const now = this.dateTime.nowMillis();

    for (const [key, entry] of this.store) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }

    while (this.store.size > DbCacheProvider.MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.store.delete(oldest);
    }
  }

  /**
   * Invalidate all cached queries for a table.
   */
  public async invalidateTable(tableName: string): Promise<void> {
    const prefix = `${tableName}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}
