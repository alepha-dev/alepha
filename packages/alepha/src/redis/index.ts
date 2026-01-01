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
 * Redis client provider for Alepha applications.
 *
 * Automatically selects the appropriate provider based on runtime:
 * - Bun: Uses `BunRedisProvider` with Bun's native Redis client (7.9x faster than ioredis)
 * - Node.js: Uses `NodeRedisProvider` with `@redis/client`
 *
 * @example
 * ```ts
 * // Inject the abstract provider - runtime selects the implementation
 * const redis = alepha.inject(RedisProvider);
 *
 * // Use common operations
 * await redis.set("key", "value");
 * const value = await redis.get("key");
 *
 * // For pub/sub
 * const subscriber = alepha.inject(RedisSubscriberProvider);
 * await subscriber.subscribe("channel", (message, channel) => {
 *   console.log(`Received: ${message} on ${channel}`);
 * });
 * ```
 *
 * @see {@link RedisProvider} - Abstract base class
 * @see {@link NodeRedisProvider} - Node.js implementation
 * @see {@link BunRedisProvider} - Bun implementation
 * @see {@link RedisSubscriberProvider} - Abstract subscriber base class
 * @see {@link NodeRedisSubscriberProvider} - Node.js subscriber implementation
 * @see {@link BunRedisSubscriberProvider} - Bun subscriber implementation
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
