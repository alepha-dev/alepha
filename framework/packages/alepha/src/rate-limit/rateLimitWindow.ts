import { $atom, z } from "alepha";

/**
 * One fixed window of a `$rateLimit` counter, stored as actor state.
 *
 * `resetAt` is the epoch-millisecond end of the window, anchored on its first
 * hit, and doubles as the state's expiry. `count` saturates at `limit + 1`.
 */
export const rateLimitWindow = $atom({
  name: "alepha.rate-limit.window",
  schema: z.object({
    count: z.integer().min(0),
    resetAt: z.integer().min(0),
  }),
  default: { count: 0, resetAt: 0 },
  serverOnly: true,
});
