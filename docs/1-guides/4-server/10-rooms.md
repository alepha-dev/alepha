# Stateful Rooms

`$websocket` is a stateless, per-message handler. A real-time game server needs
the opposite: **in-memory state that lives across messages, and an authoritative
tick loop that advances the world on the server's clock, not the client's.**
That is `$room`.

A `$room` is one stateful actor, addressed by `channelPath:roomId`, with a
lifecycle:

- it comes to life on the first join (running its `state` factory once),
- while a socket is connected and `tickHz > 0`, a loop calls `onTick(room, dt)`
  every `1000/tickHz` ms,
- when the last socket leaves, `onEmpty` runs and the state is discarded - an
  empty room costs nothing.

The **same code runs on both runtimes.** On a Node VPS the room is a plain
object in a `Map` driven by `setInterval`. On Cloudflare it is one Durable
Object per `channelPath:roomId`, the loop ticking off the DO's own clock (the
isolate stays alive while it holds a socket, so the loop keeps running; an idle
room hibernates for free). You never write a Durable Object.

## An authoritative simulation room

```typescript
import { $channel, $room } from "alepha/websocket";

class GameServer {
  world = $channel({
    path: "/ws/world",
    schema: { in: serverFrame, out: clientIntent },
  });

  room = $room({
    channel: this.world,
    tickHz: 20,
    state: () => new World(),

    onJoin: (room, conn) => room.state.spawn(conn.id),
    onMessage: (room, conn, intent) => room.state.enqueue(conn.id, intent),
    onTick: (room, dt) => {
      room.state.step(dt); // advance the authoritative sim
      for (const conn of room.connections) {
        // per-recipient AOI view
        room.send(conn.id, room.state.viewFor(conn.id));
      }
    },
    onLeave: (room, conn) => room.state.despawn(conn.id),
    onEmpty: (room) => room.state.persist(),
  });
}
```

Key points:

- **`room.state`** is your world - created by the factory, never serialized by
  the framework. Keep authoritative collections (players, monsters, loot) here.
- **`room.send(id, msg)`** targets one connection. This is what a per-recipient
  area-of-interest stream needs: each client gets a _different_ frame every tick.
  **`room.broadcast(msg, { exceptConnectionIds })`** fans out to all.
- **`conn.data`** is a per-connection bag you own (last acked input seq, hero id,
  AOI cursor…).
- **`onTick` never throws out of the loop**: an error is logged and the room
  keeps ticking. The tick loop is the speed limit; flooding messages buys no
  extra ticks.

## Headless coordinators and presence (`methods`)

Omit `tickHz` and the room is **headless**: no loop, no sockets required,
addressed by id and reached through server-side `methods`. This models
cross-room shared state and single-owner leases - reached from another room, an
HTTP action, or anywhere on the server.

```typescript
// partySchema: any z.object() / union message schema
class Party {
  channel = $channel({
    path: "/ws/party",
    schema: { in: partySchema, out: partySchema },
  });

  session = $room({
    channel: this.channel,
    state: () => ({ switches: {} as Record<string, boolean> }),
    methods: {
      setSwitch: (room, id: string, v: boolean) => {
        room.state.switches[id] = v;
      },
      snapshot: (room) => room.state.switches,
    },
  });

  async flip(partyId: string, id: string) {
    await this.session.call(partyId, "setSwitch", id, true); // one room, by id
    await this.session.broadcast(partyId, { type: "state-changed" });
  }
}
```

On Cloudflare `call()` is a Durable Object RPC; on Node it is a direct in-process
call. Either way the room comes to life lazily on its first call.

## Mapping a sharded game server onto `$room`

A cooperative RPG on Workers has three kinds of authoritative object. All
three are one `$room`:

| Game object                                                            | `$room` shape                                                          | addressed by    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------- |
| **World** (the 20Hz simulation of one map)                             | `tickHz: 20`, `state: () => new World()`, `onTick` steps + streams AOI | `partyId:mapId` |
| **Session coordinator** (party-wide switches/variables, chat, victory) | headless, `methods` mutate + snapshot, `broadcast` pushes to rooms     | `partyId`       |
| **Presence lease** (single-owner hero connection + epoch)              | headless, `methods` acquire/renew/release                              | `heroId`        |

The pure simulation (`step()`, reconciliation, the wire protocol) stays in your
own runtime-free package and is called from `onTick`/`onMessage` - Alepha never
touches it.

## Node vs Cloudflare: what differs

|                      | Node (VPS)          | Cloudflare                                            |
| -------------------- | ------------------- | ----------------------------------------------------- |
| Room instance        | object in a `Map`   | one Durable Object per `channel:room`                 |
| Tick loop            | `setInterval`       | `setInterval` inside the DO (alive while a socket is) |
| `state` in memory    | one process, shared | per-DO; survives while the room is warm               |
| Coordinator `call()` | direct method call  | DO-to-DO RPC                                          |
| Transactions         | full SQL            | D1 has no multi-statement transactions                |

On a single VPS you have shared memory and real timers, so a coordinator/lease is
just a headless room in the same process. On Cloudflare the same headless room is
a Durable Object - durable state that outlives an isolate must be persisted
inside a `method`/`onEmpty` (its `state` is in-memory and lost if the DO is
evicted while idle). An actively-ticking world room stays warm and keeps its
state for as long as it ticks.

**Watchdog.** A `$room` on Cloudflare relies on the isolate staying warm while it
holds a socket. To recover from a rare mid-connection isolate reset, a Durable
Object `alarm()` fires every ~10s while the room holds sockets: it re-hydrates
any hibernation socket the fresh in-memory engine has forgotten (which restarts
the tick loop) and re-arms itself. Connectivity and the loop come back
automatically; the room _state_ does not (in-memory state cannot survive
eviction), so persist anything durable in `onEmpty` or a `method`.
