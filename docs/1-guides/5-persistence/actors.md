# Actor state

`alepha/actor` declares independent default and keyed state from an atom descriptor.
Node and Bun use volatile Memory per container. Actor snapshots do not synchronize
with the local atom store, SSR hydration, browser persistence or React subscriptions.

```typescript
import { $atom, z } from "alepha";
import { $actor } from "alepha/actor";

const counter = $atom({ name: "counter", schema: z.integer(), default: 0 });
class CounterService {
  counter = $actor({
    atom: counter,
    methods: {
      add: (state, amount: number = 1) => state + amount,
    },
  });
  async increment() {
    await this.counter.add();
    return this.counter.get("alice").add(2);
  }
}
```

`get(key)` is synchronous and requires a nonempty string. The default actor and
`get("default")` are separate instances. `read()` and method calls lazily initialize
state and return detached committed snapshots. Failed transitions preserve state.

Reducers must be deterministic synchronous functions with no I/O, time, randomness,
mutable captured dependencies or other side effects. They receive recursively readonly
state and detached arguments and return the next state. Only lossless JSON values are
supported; explicit undefined, nonfinite numbers, negative zero, sparse arrays,
accessors, class instances and cycles are rejected. Optional trailing arguments may
be omitted. Async schemas and Promise reducer results are unsupported. Stored schema
incompatibility fails closed without resetting to the default.

## Redis on Node and Bun

Select `AlephaActorRedis` from `alepha/actor/redis` explicitly with
`alepha.with(AlephaActorRedis)`. Set `ALEPHA_ACTOR_NAMESPACE` to a nonempty stable
application namespace before selection. `REDIS_URL` alone leaves Memory selected.
The provider uses the existing runtime Redis variants with a dedicated connection
and offline command replay disabled. Start the container before calling actors.

Each transition validates its candidate locally, then commits one key with an exact
observed-byte Lua compare-and-set. Only definite conflicts retry, from fresh state
and the original detached arguments. `actorRedisOptions` configures positive
`maxAttempts` (default 32). Exhaustion throws `ActorContentionError`.

State has no TTL or local read cache. Redis persistence and failover configuration
determine restart durability; eviction loses state. A transport failure after a
commit can leave its outcome unknown. The provider does not retry that invocation,
and callers must not assume exactly-once delivery. Corrupt, incompatible or
unknown-version stored data fails closed. Changing namespace or atom name selects
new state without migrating or deleting old state.

See [Redis scripting](https://redis.io/docs/latest/develop/programmability/eval-intro/),
[Redis persistence](https://redis.io/docs/latest/management/persistence/) and
[Node Redis production behavior](https://redis.io/docs/latest/develop/clients/nodejs/produsage/).

## Cloudflare workerd

Workerd selects the shared `AlephaActorDurableObject` host with the `ALEPHA_ACTOR`
binding. Each encoded namespace/name/default-or-key tuple has its own instance.
The namespace defaults to the empty string within the Worker/class namespace;
`ALEPHA_ACTOR_NAMESPACE` may add a stable application scope. A missing binding
fails without falling back to Memory.

The host resolves registered pure reducers without starting the full application,
so an application start hook can call an actor without recursively starting itself.
It serializes initialization, reads and transitions and awaits validated protocol-v1
KV writes on SQLite-backed storage before success. Restarted hosts read persisted
state. Failed transitions retain the previous snapshot; corrupt or incompatible
stored state fails closed. No native SQL API, alarms or subscriptions are exposed.

Generic `ActorHostRegistry` declarations and `ActorHostRuntime` namespace and
startup facilities are runtime-neutral. Native host imports stay workerd-only.
[Cloudflare storage documentation](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
describes the underlying storage guarantees. Local workerd recovery evidence does
not prove live provisioning or production hibernation.
