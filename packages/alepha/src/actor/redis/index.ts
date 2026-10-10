import { $module, AlephaError } from "alepha";
import { AlephaActor, ActorProvider } from "alepha/actor";

import { actorRedisOptions } from "./actorRedisOptions.ts";
import { ActorRedisConnection } from "./providers/ActorRedisConnection.ts";
import { NodeActorRedisProvider } from "./providers/NodeActorRedisProvider.ts";
import { RedisActorProvider } from "./providers/RedisActorProvider.ts";
export * from "./index.shared.ts";

/**
 * Explicit Redis actor selection for Node and Bun. Requires a nonempty
 * ALEPHA_ACTOR_NAMESPACE before connecting. Durability depends on Redis
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
    if (!String(alepha.env.ALEPHA_ACTOR_NAMESPACE ?? "").trim())
      throw new AlephaError("Redis actors require ALEPHA_ACTOR_NAMESPACE");
    alepha.with({ provide: ActorRedisConnection, use: NodeActorRedisProvider });
    alepha.with({ provide: ActorProvider, use: RedisActorProvider });
  },
});
export * from "./providers/NodeActorRedisProvider.ts";
