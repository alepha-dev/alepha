# $room

## Import

```typescript
import { $room } from "alepha/websocket";
```

## Overview

Defines a **stateful** WebSocket room — the home for an authoritative,
optionally tick-driven simulation.

Where {@link $websocket} is a stateless, per-message pub/sub handler, `$room`
holds in-memory state across messages and drives a server-side tick loop. It
is the primitive a real-time game server is built on:

- `tickHz > 0` → an authoritative simulation room. The loop runs only while a
  socket is connected (an empty room costs nothing), calling `onTick(room, dt)`
  every `1000/tickHz` ms. Inside a tick you read `room.state`, iterate
  `room.connections`, and push per-recipient frames with `room.send(id, msg)`
  or `room.broadcast(msg)`.
- `tickHz` omitted → a **headless coordinator** addressed by id and reached
  through server-side `methods`. This is how you model cross-room party state
  or a single-owner presence lease.

Same code runs on Node (one process, real timers) and on Cloudflare (one
Durable Object per `channelPath:roomId`, the loop alive while the socket is).

## Examples

An authoritative 20Hz world
```typescript
class GameServer {
  world = $channel({ path: "/ws/world", schema: { in: serverMsg, out: clientIntent } });

  room = $room({
    channel: this.world,
    tickHz: 20,
    state: () => new World(),
    onJoin:    (room, conn) => room.state.addPlayer(conn.id),
    onMessage: (room, conn, intent) => room.state.enqueue(conn.id, intent),
    onTick:    (room, dt) => {
      room.state.step(dt);
      for (const conn of room.connections) room.send(conn.id, room.state.viewFor(conn.id));
    },
    onLeave:   (room, conn) => room.state.removePlayer(conn.id),
    onEmpty:   (room) => room.state.persist(),
  });
}
```

A headless coordinator (party-wide state)
```typescript
class Coordinator {
  party = $channel({ path: "/ws/party", schema: { in: any, out: any } });

  session = $room({
    channel: this.party,
    state: () => ({ switches: {} as Record<string, boolean> }),
    methods: {
      setSwitch: (room, id: string, value: boolean) => { room.state.switches[id] = value; },
      snapshot:  (room) => room.state.switches,
    },
  });

  async flip(partyId: string, id: string) {
    await this.session.call(partyId, "setSwitch", id, true);
  }
}
```

