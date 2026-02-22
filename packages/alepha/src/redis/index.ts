import { $module, type Alepha } from "alepha";
import { BunRedisProvider } from "./providers/BunRedisProvider.ts";
import { BunRedisSubscriberProvider } from "./providers/BunRedisSubscriberProvider.ts";
import { NodeRedisProvider } from "./providers/NodeRedisProvider.ts";
import { NodeRedisSubscriberProvider } from "./providers/NodeRedisSubscriberProvider.ts";
import { RedisProvider } from "./providers/RedisProvider.ts";
import { RedisSubscriberProvider } from "./providers/RedisSubscriberProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/BunRedisProvider.ts";
export * from "./providers/BunRedisSubscriberProvider.ts";
export * from "./providers/NodeRedisProvider.ts";
export * from "./providers/NodeRedisSubscriberProvider.ts";
export * from "./providers/RedisProvider.ts";
export * from "./providers/RedisSubscriberProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Redis client wrapper.
 *
 * **Features:**
 * - Connection pooling
 * - Automatic reconnection
 * - Command pipelining
 * - Pub/sub support
 *
 * @module alepha.redis
 */
export const AlephaRedis = $module({
  name: "alepha.redis",
  services: [
    NodeRedisProvider,
    NodeRedisSubscriberProvider,
    BunRedisProvider,
    BunRedisSubscriberProvider,
    RedisProvider,
    RedisSubscriberProvider,
  ],
  register: (alepha: Alepha) => {
    if (alepha.isBun()) {
      alepha
        .with({
          provide: RedisProvider,
          use: BunRedisProvider,
        })
        .with({
          provide: RedisSubscriberProvider,
          use: BunRedisSubscriberProvider,
        });
    } else {
      alepha
        .with({
          provide: RedisProvider,
          use: NodeRedisProvider,
        })
        .with({
          provide: RedisSubscriberProvider,
          use: NodeRedisSubscriberProvider,
        });
    }
  },
});
