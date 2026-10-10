import { $atom, z } from "alepha";
/**
 * Positive maximum compare-and-set attempts per initialization or transition.
 */
export const actorRedisOptions = $atom({
  name: "alepha.actor.redis.options",
  schema: z.object({ maxAttempts: z.integer().positive() }),
  default: { maxAttempts: 32 },
  serverOnly: true,
});
