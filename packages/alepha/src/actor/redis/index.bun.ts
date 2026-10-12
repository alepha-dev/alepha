import { $module } from "alepha";
import { AlephaActor, ActorProvider } from "alepha/actor";

import { actorRedisOptions } from "./actorRedisOptions.ts";
import { ActorRedisConnection } from "./providers/ActorRedisConnection.ts";
import { BunActorRedisProvider } from "./providers/BunActorRedisProvider.ts";
import { RedisActorProvider } from "./providers/RedisActorProvider.ts";
export * from "./index.shared.ts";

/**
 * Explicit Redis actor selection for Node and Bun. Every actor identity
 * carries `alepha.name` (APP_NAME, else the build's app name, else "app"),
 * so two apps on one Redis never share actor state. Durability depends on Redis
 * persistence, eviction and failover configuration, without exactly-once claims.
 *
 * @module alepha.actor.redis
 */
export const AlephaActorRedis = $module({
  name: "alepha.actor.redis",
  imports: [AlephaActor],
  atoms: [actorRedisOptions],
  variants: [RedisActorProvider, BunActorRedisProvider],
  register: (alepha) => {
    alepha.with({ provide: ActorRedisConnection, use: BunActorRedisProvider });
    alepha.with({ provide: ActorProvider, use: RedisActorProvider });
  },
});
export * from "./providers/BunActorRedisProvider.ts";
