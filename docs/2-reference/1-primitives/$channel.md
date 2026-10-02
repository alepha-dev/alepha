# $channel

## Import

```typescript
import { $channel } from "alepha/websocket";
```

## Overview

Defines a WebSocket channel with specified client and server message schemas.

Channels must be defined as class properties to be registered in the Alepha context.
They define the "vocabulary" for communication - the schema for messages flowing
in both directions (server→client and client→server).

## Options

| Option        | Type     | Required | Description                                     |
| ------------- | -------- | -------- | ----------------------------------------------- |
| `path`        | `string` | Yes      | WebSocket endpoint path (e.g., "/ws/chat")      |
| `description` | `string` | No       | Optional description for documentation          |
| `schema`      | `Object` | Yes      | Message schemas for bidirectional communication |

## Examples

Server-side with $websocket

```typescript
class ChatController {
  // Channel must be defined inside a class
  chatChannel = $channel({
    path: "/ws/chat",
    description: "Real-time chat channel",
    schema: {
      // Server → Client messages
      in: z.union([
        z.object({
          type: z.const("append"),
          content: z.text(),
          username: z.text(),
        }),
        z.object({
          type: z.const("system"),
          message: z.text(),
        }),
      ]),
      // Client → Server messages
      out: z.object({
        content: z.text(),
      }),
    },
  });

  chat = $websocket({
    channel: this.chatChannel,
    handler: async ({ message, reply }) => {
      await reply({
        message: { type: "append", content: message.content, username: "user" },
      });
    },
  });
}
```

Browser-side with useRoom

```typescript
// Define channel in a class for browser context
class ChatClient {
  chatChannel = $channel({
    path: "/ws/chat",
    schema: { in: inSchema, out: outSchema }
  });
}

// Use in React component
function Chat() {
  const client = useInject(ChatClient);
  const chat = useRoom({ roomId: "lobby", channel: client.chatChannel, handler: ... }, []);
}
```
