import { $module } from "alepha";
import { AlephaActor, ActorProvider } from "alepha/actor";

import { actorRedisOptions } from "./actorRedisOptions.ts";
import { ActorRedisConnection } from "./providers/ActorRedisConnection.ts";
import { NodeActorRedisProvider } from "./providers/NodeActorRedisProvider.ts";
import { RedisActorProvider } from "./providers/RedisActorProvider.ts";
export * from "./index.shared.ts";

/**
 * Explicit Redis actor selection for Node and Bun. Every actor identity
 * carries `alepha.name` (APP_NAME, else the build's app name, else "app"),
 * so two apps on one Redis never share actor state. Durability depends on Redis
 * persistence, eviction and failover configuration, without exactly-once claims.
 * REDIS_URL alone does not select this provider. Start the container before use.
 * Only definite compare-and-set conflicts retry pure reducers; transport failures
 * propagate without replay because a commit can have succeeded before the error.
 *
 * @module alepha.actor.redis
 */
export const AlephaActorRedis = $module({
  name: "alepha.actor.redis",
  imports: [AlephaActor],
  atoms: [actorRedisOptions],
  variants: [RedisActorProvider, NodeActorRedisProvider],
  register: (alepha) => {
    alepha.with({ provide: ActorRedisConnection, use: NodeActorRedisProvider });
    alepha.with({ provide: ActorProvider, use: RedisActorProvider });
  },
});
export * from "./providers/NodeActorRedisProvider.ts";
