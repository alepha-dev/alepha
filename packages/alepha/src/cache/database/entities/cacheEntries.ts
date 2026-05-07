import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * Storage table for the {@link DatabaseCacheProvider}.
 *
 * Each row represents one cache entry:
 * - `(container, cacheKey)` is the logical key (uniqueness enforced by index).
 * - `value` holds base64-encoded bytes for `set/get/setTyped/getTyped`.
 * - `count` holds an integer counter for atomic `incr` operations.
 * - `expiresAt` is null for entries that never expire, or a timestamp after
 *   which the entry is considered gone (filtered out at read time).
 */
export const cacheEntries = $entity({
  name: "cache_entries",
  schema: t.object({
    id: db.primaryKey(t.uuid()),

    createdAt: db.createdAt(),

    container: t.text({
      description: "Cache container name, set by the $cache primitive.",
    }),

    cacheKey: t.text({
      description: "Per-container key chosen by the caller.",
    }),

    value: t.optional(
      // No maxLength: cache values are arbitrary-sized (especially when
      // `compress: true` is enabled on the $cache primitive, which can
      // produce blobs well above the default 255-char `t.text()` cap). This
      // resolves to TEXT in both Postgres and SQLite, which have no
      // practical length limit either.
      t.string({
        description: "Base64-encoded bytes. Used by set/get.",
      }),
    ),

    count: t.optional(
      t.integer({
        description: "Counter value. Used by atomic incr().",
      }),
    ),

    expiresAt: t.optional(
      t.datetime({
        description: "Null means no expiration.",
      }),
    ),
  }),
  indexes: [{ columns: ["container", "cacheKey"], unique: true }, "expiresAt"],
});

export type CacheEntry = Static<typeof cacheEntries.schema>;
