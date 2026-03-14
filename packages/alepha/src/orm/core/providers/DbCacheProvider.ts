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
 */
export class DbCacheProvider {
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
