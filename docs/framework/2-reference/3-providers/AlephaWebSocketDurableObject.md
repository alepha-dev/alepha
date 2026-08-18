# AlephaWebSocketDurableObject

## Import

```typescript
import { AlephaWebSocketDurableObject } from "alepha/websocket";
```

## Overview

Durable Object that hosts one room's WebSocket connections on Cloudflare.

This class is intentionally a thin adapter: every entry point forwards
straight to a `WebSocketRoom` instance, which holds all the actual logic
and has zero dependency on `cloudflare:workers`. That module does not exist
under Vitest, so this file must never be imported from a `.spec.ts` — it is
only reached via the generated workerd entry point
(`index.workerd.ts`).

One instance per `channelPath:roomId` (addressed by the provider via
idFromName). Uses the WebSocket Hibernation API so idle rooms cost nothing
and survive isolate eviction. The user's `$websocket` handler runs INSIDE
this object, so `reply()` fans out over this DO's own sockets with no
cross-isolate hop. The DO replaces the `$topic` bus used by the Node
provider.

