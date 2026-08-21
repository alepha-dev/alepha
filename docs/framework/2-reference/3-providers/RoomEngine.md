# RoomEngine

## Import

```typescript
import { RoomEngine } from "alepha/websocket";
```

## Overview

Runtime-neutral heart of a stateful room: it owns the in-memory state, the
connected sockets, the authoritative tick loop, per-recipient send and the
room lifecycle - with zero dependency on Node's `ws` or on
`cloudflare:workers`. Both providers construct one of these and feed it their
native sockets through the `RoomSocket` adapter.

Lifecycle: the room comes to life lazily (first `join`, or first `call` on a
headless room), running the `state` factory once. While at least one socket
is connected and `tickHz > 0`, a loop calls `onTick` every `1000/tickHz` ms.
When the last socket leaves, `onEmpty` runs, the loop stops and the state is
discarded - so an empty room costs nothing.
