# CloudflareDurableObjectWebSocketServerProvider

## Import

```typescript
import { CloudflareDurableObjectWebSocketServerProvider } from "alepha/websocket";
```

## Overview

WebSocket server provider backed by Cloudflare Durable Objects.

One DO per `channelPath:roomId`. Server-initiated emit is room-scoped:
roomId/roomIds resolve to DO stubs and call their broadcast RPC. Non-room
targeting (userId(s), connectionId(s), or channel-wide) is not supported in
v1 and throws - see docs. The inbound path (client message -> handler ->
reply) runs inside the DO and never reaches this provider.

