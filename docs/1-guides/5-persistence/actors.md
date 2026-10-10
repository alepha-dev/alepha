# Actor state

`alepha/actor` declares independent default and keyed state from an atom descriptor.
Node and Bun use volatile Memory per container. Workerd uses a native Durable Object
host. Browser and native client runtimes reject actor execution. Actor snapshots do
not synchronize with the local atom store, SSR hydration, browser persistence or
React subscriptions. The atom supplies its stable name, schema and default; it is
not the actor's live storage.

```typescript check
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
state and return detached snapshots. A method resolves to the state committed by
that call, even if a later concurrent call has already changed the stored state.
`read()` returns the state observed by that read. Neither returns a method-specific
result or a live subscription. A failed transition preserves the previous state;
if it was the first call, the validated default has already been initialized.

For example, `alepha.store.set(counter, 100)` leaves `service.counter.read()`
unchanged, and `service.counter.add()` leaves the ordinary store value unchanged
when `service` is the injected `CounterService`. Changing a namespace
or atom name selects new state; it does not migrate or delete previous snapshots.
Two distinct actor declarations cannot reuse the same atom name in one container.
Method names are own properties and cannot shadow `get`, `read`, `then`, primitive
members or object prototype members.

## Nested session state

Keep the schema separate from the service and return a new value from each reducer:

```typescript
// sessionState.ts
import { z } from "alepha";

export const sessionSchema = z.object({
  names: z.array(z.text()),
  nested: z.object({ count: z.integer() }),
});
```

```typescript
// SessionService.ts
import { $atom } from "alepha";
import { $actor } from "alepha/actor";

import { sessionSchema } from "./sessionState.ts";

const session = $atom({
  name: "session",
  schema: sessionSchema,
  default: { names: [], nested: { count: 0 } },
});

class SessionService {
  session = $actor({
    atom: session,
    methods: {
      append: (state, input: { name: string }) => ({
        names: [...state.names, input.name],
        nested: { count: state.nested.count + 1 },
      }),
    },
  });

  async join() {
    const actor = this.session.get("party-1");
    const snapshot = await actor.append({ name: "Alice" });
    snapshot.names.push("caller-only"); // does not modify stored actor state
    return actor.read(); // names: ["Alice"], nested: { count: 1 }
  }
}
```

Arguments are copied synchronously when the call is made. Changing an input while
its call waits does not change the reducer's input. Reducer state and arguments are
recursively frozen at runtime. Returned snapshots are detached mutable values;
changing them cannot modify storage, another result or the atom default.

## Reducer and data contract

Reducers must be deterministic synchronous functions with no I/O, time, randomness,
mutable captured dependencies or other side effects. Redis may rerun a reducer
on contention, so logging, sending messages and external writes belong outside it.
Room callbacks and ordinary services can await actors; the reducer itself cannot.
Each reducer returns the complete next state, which is validated before committing.
A thrown error, invalid state, attempted mutation or Promise result rejects the call.
The per-identity queue remains usable after failure.

Only lossless JSON data is supported: null, booleans, strings, finite numbers,
dense arrays and plain objects (including null-prototype objects). Explicit
`undefined`, negative zero, nonfinite numbers, bigint, functions, symbols, symbol
keys, hidden properties, accessors, sparse or extended arrays, class instances
(including Date, Map and Set) and cycles are rejected. Omit optional properties and
trailing arguments instead of passing `undefined`. Async schemas are unsupported.

Stored envelopes have protocol version 1 and a nonnegative safe integer revision.
Corrupt data, unknown versions, invalid revisions and schema incompatibility fail
closed without resetting state. Stored validation must preserve the JSON value;
a changed schema that would strip or transform existing data is incompatible.
Revision overflow refuses further transitions. There is no automatic data migration.

## Redis on Node and Bun

Select `AlephaActorRedis` from `alepha/actor/redis` explicitly with
`alepha.with(AlephaActorRedis)`. Set `ALEPHA_ACTOR_NAMESPACE` to a nonempty stable
application namespace before selection. `REDIS_URL` alone leaves Memory selected.
The provider uses the existing runtime Redis variants with a dedicated connection
and offline command replay disabled. Start the container before calling actors.

```typescript check
import { Alepha } from "alepha";
import { AlephaActorRedis } from "alepha/actor/redis";

const alepha = Alepha.create({
  env: {
    ALEPHA_ACTOR_NAMESPACE: "my-app:production",
    REDIS_URL: "redis://localhost:6379",
  },
}).with(AlephaActorRedis);
await alepha.start();
```

Independent applications share state only when their Redis server, namespace,
atom name and default-or-key identity agree. Use separate stable namespaces for
unrelated applications or environments. Memory instead owns one container's state;
stopping the process or creating a new container loses it.

Each transition validates its candidate locally, then commits one key with an exact
observed-byte Lua compare-and-set. Only definite conflicts retry, from fresh state
and the original detached arguments. `actorRedisOptions` configures positive
`maxAttempts` (default 32). Exhaustion throws `ActorContentionError`.

State has no TTL or local read cache. Redis persistence and failover configuration
determine restart durability; eviction loses state. A transport failure after a
commit can leave its outcome unknown. The provider does not retry that invocation,
and callers must not assume exactly-once delivery. Blindly retrying a failed
increment can apply it twice; resolving an unknown business operation requires an
application-level protocol. Corrupt, incompatible or
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
stored state fails closed. Initialization and each successful transition await
storage before returning. This does not make RPC delivery exactly once: a lost
response can leave the caller uncertain whether its transition committed. No
native SQL API, alarms or subscriptions are exposed.

Generic `ActorHostRegistry` declarations and `ActorHostRuntime` namespace and
startup facilities are runtime-neutral. Native host imports stay workerd-only.
WebSocket hosts use the same runtime resolution, namespace lookup and application
startup facilities, but keep their existing socket transport and lifecycle.
`RoomEngine.state` and per-connection `conn.data` remain volatile. Accepted socket
attachments retain identity metadata across host recreation; they do not restore
room state or data bags. Persist important changes through an actor or repository
as they happen. `onEmpty` is a normal room lifecycle callback, not an eviction
recovery guarantee. See [stateful rooms](/docs/guides-server-rooms).
[Cloudflare storage documentation](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
describes the underlying storage guarantees. Local workerd recovery evidence does
not prove live provisioning or production hibernation.

## Build and namespace provisioning

Generic host declarations drive workerd facades, slice wrappers and Worker exports.
The loose build manifest records `cloudflare.durableObjects` and
`resources.hasDurableObjects`; WebSocket paths remain transport metadata.
Node and Bun slices contain no native host exports. Rebuild older prebuilt realtime
artifacts that lack host declarations before regenerating deployment configuration.

With no explicit `build.cloudflare.config.migrations`, the build generates
Durable Object `exports`. Use a Wrangler release with declarative exports support
(the repository tests Wrangler 4.147.0). The build rejects a locally installed
Wrangler schema without that feature. An external application's Wrangler is not
pinned by the framework; check its toolchain before deploying.

An explicit migrations array selects the legacy path. Historical ordered tags and
steps are preserved; new host classes are appended under a fresh `alepha-hosts-vN`
tag. Durable Object exports and legacy migrations cannot coexist. Compatible user
exports preserve their storage backend. Conflicting local bindings or required-host
lifecycle tombstones fail before artifacts are written.

Existing sockets keep `AlephaWebSocketDurableObject`, `ALEPHA_WEBSOCKET` and
`channelPath + ":" + roomId` namespace identity. Moving framework-generated
SQLite provisioning to exports is a one-way control-plane transition. Applications
that need legacy history must configure it explicitly. The framework does not
migrate application state or infer deletes, renames or transfers from removed
host declarations. See [Cloudflare class lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

The E73 command surface uses `alepha/cli/infra` for explicit infrastructure
configuration and `alepha deploy` for the full build/migrate/deploy lifecycle.
`alepha deploy --prebuilt` consumes an existing artifact and regenerates its deploy
configuration; it needs the manifest and its declared runtime slice. Shared adapters
are exported from `alepha/cli/infra-lib`.

Both Cloudflare deploy adapters read these same manifest declarations. Wrangler
receives the complete legacy configuration history. The direct Worker upload
forwards local `durable_object_namespace` bindings and declarative exports. For
legacy history it reads the applied migration tag, sends only later steps with
`old_tag`/`new_tag`, and sends no steps on a repeat deployment. Unknown tags and
failed metadata lookups refuse deployment before upload.

An explicit forced Worker deletion also destroys its actor snapshots. Durable
Object presence is recorded for actor-only artifacts, and a failed Worker deletion
keeps that namespace record. There is no separately deletable namespace resource.

Lore and Bay are separate repositories. Their consumers must upgrade the framework,
adopt E73's infra imports/commands if needed, and rebuild older prebuilt realtime
artifacts to carry generic host declarations. A framework change does not upgrade
those applications, preserve undocumented deployment history or deploy them.
