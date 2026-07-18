# WebSocketRoom

## Import

```typescript
import { WebSocketRoom } from "alepha/websocket";
```

## Overview

All the logic for hosting one room's hibernatable WebSockets on Cloudflare.

This class holds zero dependency on `cloudflare:workers` so it can be
unit-tested directly under Vitest (where that module does not exist). The
thin `AlephaWebSocketDurableObject` wrapper (which does import
`cloudflare:workers`) simply constructs one of these with its own
`ctx`/`env` and forwards every Durable Object entry point to it.

One instance per `channelPath:roomId` (addressed by the provider via
idFromName). Uses the WebSocket Hibernation API so idle rooms cost nothing
and survive isolate eviction. The user's `$websocket` handler runs INSIDE
this object, so `reply()` fans out over this room's own sockets with no
cross-isolate hop. The Durable Object replaces the `$topic` bus used by the
Node provider.

