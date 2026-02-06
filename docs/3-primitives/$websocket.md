# $websocket

> Defines a WebSocket server endpoint for a specific channel.

## Import

```typescript
import { $websocket } from "alepha/websocket";
```

## Overview

Defines a WebSocket server endpoint for a specific channel.

Server-side only. Creates a WebSocket endpoint that:
- Accepts connections from clients
- Validates incoming messages against the channel schema
- Provides room-based messaging
- Integrates with alepha/security for authentication (optional)
- Supports horizontal scaling via alepha/topic

## Examples

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

