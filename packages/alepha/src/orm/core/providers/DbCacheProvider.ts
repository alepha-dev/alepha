import { $inject } from "alepha";
import { MemoryCacheProvider } from "alepha/cache";

/**
 * Database query cache backed by `MemoryCacheProvider`.
 *
 * Uses `db:{tableName}` as the cache name and query-derived keys.
 * Provides per-table invalidation for write-through cache busting.
 */
export class DbCacheProvider {
  protected readonly cache = $inject(MemoryCacheProvider);

  protected cacheName(tableName: string): string {
    return `db:${tableName}`;
  }

  /**
   * Get a cached query result.
   */
  public async get<T>(tableName: string, cacheKey: string): Promise<T | undefined> {
    return this.cache.getTyped<T>(this.cacheName(tableName), cacheKey);
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
    await this.cache.setTyped(this.cacheName(tableName), cacheKey, value, {
      ttl,
    });
  }

  /**
   * Invalidate all cached queries for a table.
   */
  public async invalidateTable(tableName: string): Promise<void> {
    await this.cache.invalidateKeys(this.cacheName(tableName), ["*"]);
  }
}
