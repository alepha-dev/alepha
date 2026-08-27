# WebSocket

Alepha provides real-time, bidirectional messaging through the `$channel` and `$websocket` primitives. You define a typed message schema once, write a single handler, and the same application code runs unchanged on a long-lived Node process (a VPS, backed by `ws`) or on Cloudflare Workers (backed by Durable Objects). The browser client - `useRoom` - is identical on both.

> Need **in-memory state and a server-side tick loop** (a game world, a live simulation) rather than a stateless per-message handler? See [Stateful Rooms (`$room`)](/docs/guides-server-rooms).

## Quick Start

```typescript check
// channels/ChatChannels.ts
import { z } from "alepha";
import { $channel } from "alepha/websocket";

export const chatMessageSchema = z.object({
  username: z.text(),
  content: z.text(),
  timestamp: z.integer(),
});

export class ChatChannels {
  chatChannel = $channel({
    path: "/ws/chat",
    description: "Simple chat channel",
    schema: {
      in: chatMessageSchema, // server -> client
      out: z.object({ content: z.text() }), // client -> server
    },
  });
}
```

```typescript
// AppChatServer.ts
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $websocket } from "alepha/websocket";
import { ChatChannels } from "./channels/ChatChannels.ts";

export class AppChatServer {
  protected readonly channels = $inject(ChatChannels);
  protected readonly dateTime = $inject(DateTimeProvider);

  chat = $websocket({
    channel: this.channels.chatChannel,
    handler: async ({ connectionId, message, reply }) => {
      await reply({
        message: {
          username: connectionId.slice(0, 8),
          content: message.content,
          timestamp: this.dateTime.nowMillis(),
        },
      });
    },
  });
}
```

```typescript
// main.server.ts
import { Alepha, run } from "alepha";
import { AlephaWebSocket } from "alepha/websocket";
import { AppChatServer } from "./AppChatServer.ts";

const alepha = Alepha.create();
alepha.with(AlephaWebSocket);
alepha.with(AppChatServer);
run(alepha);
```

```tsx
// components/Chat.tsx
import { useInject } from "alepha/react";
import { useRoom } from "alepha/react/websocket";
import { useState } from "react";
import { ChatChannels } from "../channels/ChatChannels.ts";

export function Chat() {
  const channels = useInject(ChatChannels);
  const [messages, setMessages] = useState<any[]>([]);
  const roomId = "lobby";

  const chat = useRoom(
    {
      roomId,
      channel: channels.chatChannel,
      handler: (message) => setMessages((prev) => [message, ...prev]),
    },
    [roomId],
  );

  return (
    <button
      onClick={() => chat.send({ content: "hello" })}
      disabled={!chat.isConnected}
    >
      Send
    </button>
  );
}
```

## Defining a Channel

`$channel` declares the "vocabulary" for a WebSocket endpoint - its path and the message shapes flowing in both directions. Channels are just schema definitions; they must be defined as a class property so Alepha can register them.

```typescript check
import { z } from "alepha";
import { $channel } from "alepha/websocket";

class ChatChannels {
  chatChannel = $channel({
    path: "/ws/chat",
    description: "Real-time chat channel",
    schema: {
      // Server -> client messages
      in: z.union([
        z.object({
          type: z.const("append"),
          content: z.text(),
          username: z.text(),
        }),
        z.object({ type: z.const("system"), message: z.text() }),
      ]),
      // Client -> server messages
      out: z.object({ content: z.text() }),
      // Optional: validate roomId shape (defaults to any string)
      roomId: z.uuid(),
    },
  });
}
```

| Option          | Type                  | Description                                                            |
| --------------- | --------------------- | ---------------------------------------------------------------------- |
| `path`          | `string`              | Required. The WebSocket endpoint path (e.g. `/ws/chat`).               |
| `description`   | `string`              | Optional documentation.                                                |
| `schema.in`     | `ZObject \| ZodUnion` | Messages sent from server to client.                                   |
| `schema.out`    | `ZObject \| ZodUnion` | Messages sent from client to server.                                   |
| `schema.roomId` | `ZodString`           | Optional room ID validation (e.g. `z.uuid()`). Defaults to any string. |

Schemas use the `z` builder - the same one used by `$action`.

`schema.roomId` is enforced at the handshake on both engines: a join naming a room the schema rejects is closed with code `1008` and the reason `Invalid room id`, and every id of a multi-room join is checked, not just the first. A client that names no room at all joins `default`, which is never validated - it is the framework's fallback, not a choice, so declaring `z.uuid()` does not refuse connections that simply omit the parameter.

## Server Handler

`$websocket` turns a channel into a live server endpoint: it accepts connections, validates inbound messages against `schema.out`, and calls your handler.

```typescript
import { $websocket } from "alepha/websocket";

class ChatController {
  chat = $websocket({
    channel: this.channels.chatChannel,
    handler: async ({ connectionId, userId, roomId, message, reply }) => {
      await reply({
        message: {
          type: "append",
          username: userId ?? "anon",
          content: message.content,
        },
        exceptSelf: true,
      });
    },
    onConnect: ({ connectionId, userId, roomIds }) => {
      console.log(`${connectionId} joined ${roomIds.join(", ")}`);
    },
    onDisconnect: ({ connectionId }) => {
      console.log(`${connectionId} left`);
    },
  });
}
```

The handler context:

| Field            | Description                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `connectionId`   | Unique ID for this connection.                                                                        |
| `userId`         | Authenticated user ID, if `secure: true` and a user resolved (see [Authentication](#authentication)). |
| `roomId`         | Room the incoming message was sent from.                                                              |
| `message`        | The parsed, schema-validated client message.                                                          |
| `reply(options)` | Send a message back to the room, scoped to this connection's context.                                 |

`reply()` options:

| Option                | Type             | Description                                                                                                 |
| --------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `message`             | `Infer<TClient>` | Required. The message to send.                                                                              |
| `roomId`              | `string`         | Target room. Defaults to the sender's room.                                                                 |
| `exceptSelf`          | `boolean`        | Exclude the sender's own connection.                                                                        |
| `exceptConnectionIds` | `string[]`       | Exclude specific connections.                                                                               |
| `exceptUserIds`       | `string[]`       | Exclude specific users. Requires `alepha/security`. **Not honored on the Cloudflare provider** - see below. |

## Server-Initiated Messages

Beyond replying to an incoming message, a `$websocket` instance exposes `emit()` to push messages from anywhere in your app - a cron job, an `$action`, a database hook:

```typescript
class NotificationService {
  protected readonly chat = $inject(ChatController).chat;

  async broadcastAnnouncement(roomId: string, text: string) {
    await this.chat.emit({
      roomId,
      message: { type: "system", message: text },
    });
  }
}
```

`emit()` accepts:

| Option                                  | Description                                          |
| --------------------------------------- | ---------------------------------------------------- |
| `message`                               | Required.                                            |
| `roomId` / `roomIds`                    | Target one or more rooms.                            |
| `userId` / `userIds`                    | Target a user's connections (Node only - see below). |
| `connectionId` / `connectionIds`        | Target specific connections (Node only - see below). |
| `exceptConnectionIds` / `exceptUserIds` | Exclusions.                                          |

## Client

`useRoom` is the React hook for connecting to a room. Multiple `useRoom` calls on the same channel share a single underlying WebSocket connection.

```tsx
import { useInject } from "alepha/react";
import { useRoom } from "alepha/react/websocket";

function Chat() {
  const channels = useInject(ChatChannels);

  const chat = useRoom(
    {
      roomId: "lobby",
      channel: channels.chatChannel,
      handler: (message) => {
        if (message.type === "append") {
          // ... append to state
        }
      },
    },
    ["lobby"], // deps - reconnects when these change
  );

  return (
    <button
      onClick={() => chat.send({ content: "hi" })}
      disabled={!chat.isConnected}
    >
      Send
    </button>
  );
}
```

`useRoom` returns `{ send, isConnected, isConnecting, isError, error, reconnect, disconnect }`. On the server (SSR), it no-ops safely.

The connection URL is auto-detected from `window.location` by default. Override it with the `url` option, or via environment variables:

| Env Var                            | Default            | Description                                       |
| ---------------------------------- | ------------------ | ------------------------------------------------- |
| `WEBSOCKET_URL`                    | `""` (auto-detect) | WebSocket server URL, e.g. `ws://localhost:3001`. |
| `WEBSOCKET_RECONNECT_INTERVAL`     | `3000`             | Milliseconds between reconnect attempts.          |
| `WEBSOCKET_MAX_RECONNECT_ATTEMPTS` | `10`               | Set to `-1` for infinite retries.                 |

## Authentication

Set `secure: true` on `$websocket` to require authentication, and `maxConnectionsPerUser` to cap how many concurrent connections a user may hold:

```typescript
chat = $websocket({
  channel: this.channels.chatChannel,
  handler: async ({ userId, message, reply }) => {
    /* ... */
  },
  secure: true,
  maxConnectionsPerUser: 3,
});
```

Identity is resolved from the WebSocket handshake through `alepha/security`'s usual resolver chain, fed with the handshake's URL and headers (including `cookie`). Browsers cannot set custom headers on a WebSocket handshake, so in practice this means:

- A session **cookie** is sent automatically by the browser and works out of the box.
- Any other credential (e.g. a bearer token) must travel as a query parameter - `?token=` or `?api_key=` - since it can't go in an `Authorization` header.

An unauthenticated connection to a `secure: true` endpoint is rejected before the upgrade completes. This works identically on both the Node and Cloudflare providers.

**What `maxConnectionsPerUser` counts differs by engine.** On Node the server holds every connection, so the cap is per endpoint: three connections total, whichever rooms they joined. On Cloudflare a Durable Object IS one room and only knows its own sockets, so the cap is per room: the same user may hold three in each room they join. Counting across rooms would put a second coordinator object on the path of every upgrade, which is a real cost for a limit that exists to stop one user opening tabs without end. Both engines refuse the same way, closing the socket with code `1008` and the reason `Max connections per user exceeded`, so a client cannot tell them apart. An unauthenticated connection is never capped on either, since there is no identity to count against.

## Node / VPS

On Node, `alepha/websocket` runs on top of the `ws` package, attached to the same HTTP server as the rest of your app. A connection can join multiple rooms at once (e.g. `?roomIds=room-1,room-2`) - `useRoom`/`WebSocketClient` sends all active room subscriptions as query params when it connects.

For horizontal scaling across multiple Node instances, server-initiated messages (`reply()`, `emit()`) are distributed via `alepha/topic` (in-memory locally, Redis in production via `alepha/topic/redis`): one instance publishes, every instance receives, and each forwards to its own local connections that match.

Because Cloudflare allows only one room per connection (see below), joining multiple rooms on Node is **not portable**. The Node provider logs a dev-only warning when a connection joins more than one room, so you notice before deploying to Cloudflare.

## Cloudflare (Durable Objects)

On Cloudflare, `alepha/websocket` is backed by one **Durable Object per `channelPath:roomId`**, using the WebSocket Hibernation API so idle rooms cost nothing and survive isolate eviction. Your `$websocket` handler runs _inside_ that Durable Object, so `reply()` is a local fan-out over the DO's own sockets - there is no cross-isolate hop, and no Redis or `alepha/topic` bus is needed. The Durable Object _is_ the topic bus.

This gives the same channel/handler code as Node, with a few v1 limitations worth knowing:

**`emit` is room-scoped only.** `emit({ roomId })` and `emit({ roomIds })` work - each resolves to a Durable Object stub and calls its broadcast RPC. Targeting a `userId`/`connectionId`, or a channel-wide broadcast (no target at all), throws an `AlephaError` instead of silently doing nothing.

**One room per connection.** A client socket is accepted by exactly one Durable Object, so a connection belongs to exactly one room - there is no equivalent of Node's multi-room connections. This is the _portable contract_: code that only ever joins a single room per connection behaves identically on both providers. If you rely on Node's multi-room support, watch for its dev-mode warning before deploying to Cloudflare.

**`exceptUserIds` is not honored on Cloudflare.** `reply()`'s and `emit()`'s `exceptConnectionIds` work as expected; `exceptUserIds` is silently ignored by the Cloudflare provider (it only tracks connections, not the user index Node maintains). Use `exceptConnectionIds` if you need to exclude specific clients.

**Deployment is automatic.** `alepha build -t cloudflare` detects `$websocket` usage and generates the Durable Object binding and its SQLite migration into `wrangler.jsonc` - no manual wrangler configuration needed:

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "ALEPHA_WEBSOCKET",
        "class_name": "AlephaWebSocketDurableObject",
      },
    ],
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["AlephaWebSocketDurableObject"] },
  ],
}
```

Deploy and test locally with:

```bash
yarn alepha build -t cloudflare
npx wrangler dev
```

Open two browser tabs on the same room to see messages broadcast between them; a different room stays isolated.
