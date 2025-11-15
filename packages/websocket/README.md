# Alepha Websocket

Real-time bidirectional communication using WebSockets.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides real-time bidirectional communication using WebSockets.

The WebSockets module enables building real-time applications using the `$websocket` descriptor
on class properties. It provides automatic connection management, message routing, type-safe
message handling, and seamless integration with other Alepha modules.

On the server side (Node.js), it uses the 'ws' library to create a WebSocket server.
On the client side (browser), it uses the native WebSocket API.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaWebsocket } from "alepha/websocket";

const alepha = Alepha.create()
	.with(AlephaWebsocket);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $channel()

Channel descriptor options
/
export interface ChannelDescriptorOptions<
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

Channels are reusable across multiple WebSocket server endpoints and client connections.
They define the "vocabulary" for communication - the schema for messages flowing
in both directions (server→client and client→server).

```typescript
const chatChannel = $channel({
  path: "/ws/chat",
  description: "Real-time chat channel",
  schema: {
    // Server → Client messages
    in: t.union([
      t.object({
        type: t.const("append"),
        content: t.string(),
        username: t.string()
      }),
      t.object({
        type: t.const("remove"),
        messageId: t.uuid()
      })
    ]),
    // Client → Server messages
    out: t.object({
      content: t.text()
    })
  }
});
```

#### $websocket()

Defines a WebSocket server endpoint for a specific channel.

Server-side only. Creates a WebSocket endpoint that:
- Accepts connections from clients
- Validates incoming messages against the channel schema
- Provides room-based messaging
- Integrates with @alepha/security for authentication (optional)
- Supports horizontal scaling via @alepha/topic

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
