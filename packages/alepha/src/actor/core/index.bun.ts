import { $module } from "alepha";
import { RedisActivation } from "alepha/redis";

import { actorRedisOptions } from "./atoms/actorRedisOptions.ts";
import { $actor } from "./primitives/$actor.ts";
import { ActorHostRegistry } from "./providers/ActorHostRegistry.ts";
import { ActorProvider } from "./providers/ActorProvider.ts";
import { ActorRedisConnection } from "./providers/ActorRedisConnection.ts";
import { BunActorRedisProvider } from "./providers/BunActorRedisProvider.ts";
import { MemoryActorProvider } from "./providers/MemoryActorProvider.ts";
import { RedisActorProvider } from "./providers/RedisActorProvider.ts";
export * from "./index.shared.ts";
export * from "./atoms/actorRedisOptions.ts";
export * from "./providers/ActorRedisConnection.ts";
export * from "./providers/BunActorRedisProvider.ts";
export * from "./providers/MemoryActorProvider.ts";
export * from "./providers/RedisActorProvider.ts";

/**
 * Pure synchronous JSON reducers with independent default/keyed snapshots.
 *
 * On Node and Bun, `REDIS_URL` selects Redis: every instance shares actor
 * state, and every `$rateLimit` becomes cross-instance. Without it, state is
 * volatile per-container Memory, one instance. An app's own `ActorProvider`
 * substitution wins over both.
 *
 * With Redis, every actor identity carries `alepha.name` (APP_NAME, else the
 * build's app name, else "app"), so two apps on one Redis never share actor
 * state. Durability depends on Redis persistence, eviction and failover
 * configuration, without exactly-once claims. Only definite compare-and-set
 * conflicts retry pure reducers; transport failures propagate without replay
 * because a commit can have succeeded before the error.
 *
 * The Bun half binds `BunActorRedisProvider`: `alepha/redis` resolves to its
 * Bun barrel there, which has no `NodeRedisProvider` to extend. Keep its
 * exports in step with `index.ts` by hand, Bun provider for Node provider.
 *
 * @module alepha.actor
 */
export const AlephaActor = $module({
  name: "alepha.actor",
  primitives: [$actor],
  atoms: [actorRedisOptions],
  services: [ActorProvider],
  variants: [MemoryActorProvider, RedisActorProvider, BunActorRedisProvider],
  register: (alepha) => {
    alepha.inject(ActorHostRegistry).register(ActorHostRegistry.actor);
    if (alepha.inject(RedisActivation).isActive()) {
      alepha.with({
        optional: true,
        provide: ActorRedisConnection,
        use: BunActorRedisProvider,
      });
      alepha.with({
        optional: true,
        provide: ActorProvider,
        use: RedisActorProvider,
      });
      return;
    }
    alepha.with({
      optional: true,
      provide: ActorProvider,
      use: MemoryActorProvider,
    });
  },
});
