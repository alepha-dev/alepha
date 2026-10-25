import { type Infer, z } from "alepha";
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
  schema: z.object({
    id: db.primaryKey(z.uuid()),

    createdAt: db.createdAt(),

    container: z.text({
      description: "Cache container name, set by the $cache primitive.",
    }),

    cacheKey: z.text({
      description: "Per-container key chosen by the caller.",
    }),

    value: z
      .string()
      .describe("Base64-encoded bytes. Used by set/get.")
      .optional(),

    count: z
      .integer()
      .describe("Counter value. Used by atomic incr().")
      .optional(),

    expiresAt: z.datetime().describe("Null means no expiration.").optional(),
  }),
  indexes: [{ columns: ["container", "cacheKey"], unique: true }, "expiresAt"],
});

export type CacheEntry = Infer<typeof cacheEntries.schema>;
