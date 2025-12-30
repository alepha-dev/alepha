# Alepha - Websocket

## Installation

Part of the `alepha` package. Import from `alepha/websocket`.

```bash
npm install alepha
```

## Overview

Provides real-time bidirectional communication using WebSockets.

The WebSockets module enables building real-time applications using the `$websocket` primitive
on class properties. It provides automatic connection management, message routing, type-safe
message handling, and seamless integration with other Alepha modules.

On the server side (Node.js), it uses the 'ws' library to create a WebSocket server.
On the client side (browser), it uses the native WebSocket API.

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $channel()

Channel primitive options
/
export interface ChannelPrimitiveOptions<
  TClient extends TWSObject,
  TServer extends TWSObject,
> {
  /**
  WebSocket endpoint path (e.g., "/ws/chat")
  /
  path: string;

  /**
  Optional description for documentation
  /
  description?: string;

  /**
  Message schemas for bidirectional communication
  /
  schema: {
    /**
    Optional room ID schema validation
    Default: t.text() (any string)
    Can be enforced at application level: t.uuid(), t.regex(/^[a-f0-9\-]{36}$/)
    /
    roomId?: TString;

    /**
    Messages from server to client
    This is what clients will receive
    /
    in: TClient;

    /**
    Messages from client to server
    This is what the server will receive
    /
    out: TServer;
  };
}

/**
Defines a WebSocket channel with specified client and server message schemas.

Channels must be defined as class properties to be registered in the Alepha context.
They define the "vocabulary" for communication - the schema for messages flowing
in both directions (server→client and client→server).

```typescript
class ChatController {
  // Channel must be defined inside a class
  chatChannel = $channel({
    path: "/ws/chat",
    description: "Real-time chat channel",
    schema: {
      // Server → Client messages
      in: t.union([
        t.object({
          type: t.const("append"),
          content: t.text(),
          username: t.text()
        }),
        t.object({
          type: t.const("system"),
          message: t.text()
        })
      ]),
      // Client → Server messages
      out: t.object({
        content: t.text()
      })
    }
  });

  chat = $websocket({
    channel: this.chatChannel,
    handler: async ({ message, reply }) => {
      await reply({
        message: { type: "append", content: message.content, username: "user" }
      });
    }
  });
}
```

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

#### $websocket()

Defines a WebSocket server endpoint for a specific channel.

Server-side only. Creates a WebSocket endpoint that:
- Accepts connections from clients
- Validates incoming messages against the channel schema
- Provides room-based messaging
- Integrates with alepha/security for authentication (optional)
- Supports horizontal scaling via alepha/topic

```typescript
class ChatController {
  chat = $websocket({
    channel: chatChannel,
    handler: async ({ connectionId, userId, roomId, message, reply }) => {
      // Broadcast to all in room except sender
      await reply({
        message: {
          type: "append",
          username: userId,
          content: message.content
        },
        exceptSelf: true
      });
    }
  });

  async broadcastAnnouncement(roomId: string, text: string) {
    await this.chat.emit({
      roomId,
      message: {
        type: "append",
        username: "System",
        content: text
      }
    });
  }
}
```
