import { $atom, z } from "alepha";
/**
 * Redis actor commit settings.
 *
 * `maxAttempts` bounds the compare-and-set attempts of one transition. Between
 * two attempts after a definite conflict, the provider sleeps a full-jitter
 * exponential backoff: a random delay in `[0, min(maxDelayMs, baseDelayMs *
 * 2^attempt))` milliseconds, through `DateTimeProvider`.
 *
 * `expiryGraceMs` is added to an expiring envelope's `expiresAt` for the key's
 * Redis expiry (`PXAT`), so clock skew between the app and Redis never drops a
 * key the app still reads as live. The lazy check stays authoritative.
 */
export const actorRedisOptions = $atom({
  name: "alepha.actor.redis.options",
  schema: z.object({
    maxAttempts: z.integer().positive(),
    baseDelayMs: z.integer().min(0),
    maxDelayMs: z.integer().min(0),
    expiryGraceMs: z.integer().min(0),
  }),
  default: {
    maxAttempts: 32,
    baseDelayMs: 1,
    maxDelayMs: 50,
    expiryGraceMs: 60_000,
  },
  serverOnly: true,
});
