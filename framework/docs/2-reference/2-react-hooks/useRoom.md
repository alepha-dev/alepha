# useRoom

## Import

```typescript
import { useRoom } from "alepha/react/websocket";
```

## Overview

React hook for WebSocket room communication

Provides automatic connection management, reconnection, and type-safe messaging
for WebSocket rooms using the injected WebSocketClient service.

Multiple useRoom hooks on the same channel will share a single WebSocket connection.

## Examples

```tsx
const chat = useRoom(
  {
    roomId: "room-123",
    channel: chatChannel,
    handler: (message) => {
      if (message.type === "append") {
        setMessages((prev) => [...prev, message]);
      }
    },
  },
  [roomId],
);

const sendMessage = async () => {
  await chat.send({
    content: "Hello, world!",
  });
};
```
