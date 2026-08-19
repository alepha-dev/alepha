import { $module } from "alepha";
import { AlephaCache } from "alepha/cache";
import { DatabaseCacheProvider } from "./providers/DatabaseCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/cacheEntries.ts";
export * from "./providers/DatabaseCacheProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Cache that stores entries in the application's SQL database.
 *
 * Adds a `cache_entries` table and a {@link DatabaseCacheProvider}
 * implementation of {@link CacheProvider} that:
 *
 * - reads/writes through the framework's ORM (Postgres, SQLite, D1, Bun);
 * - exposes an **atomic** `incr()` via `INSERT ... ON CONFLICT DO UPDATE`;
 * - filters expired rows on every read (lazy expiration);
 * - opportunistically sweeps a small batch of expired rows on writes
 *   (configurable via {@link databaseCacheOptions}).
 *
 * **Module is opt-in.** Importing this module does not change the default
 * `CacheProvider` binding - pass `provider: DatabaseCacheProvider` explicitly
 * to the relevant `$cache(...)` calls, or rebind globally via
 * `alepha.with({ provide: CacheProvider, use: DatabaseCacheProvider })`.
 *
 * @see {@link DatabaseCacheProvider}
 * @module alepha.cache.database
 */
export const AlephaCacheDatabase = $module({
  name: "alepha.cache.database",
  services: [DatabaseCacheProvider],
  register: (alepha) => alepha.with(AlephaCache),
});
