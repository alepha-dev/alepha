import { $module, type Alepha } from "alepha";
import { RedisProvider } from "./providers/RedisProvider.ts";
import { RedisSubscriberProvider } from "./providers/RedisSubscriberProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/RedisProvider.ts";
export * from "./providers/RedisSubscriberProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Redis client provider for Alepha applications.
 *
 * @see {@link RedisProvider}
 * @module alepha.redis
 */
export const AlephaRedis = $module({
  name: "alepha.redis",
  services: [RedisProvider, RedisSubscriberProvider],
  register: (alepha: Alepha) => alepha.with(RedisProvider),
});
