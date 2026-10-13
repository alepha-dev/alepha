# ActorHost

## Import

```typescript
import { ActorHost } from "alepha/actor";
```

## Overview

One instance's serialized protocol KV snapshots on SQLite-backed storage.
Storage and host identity never enter the shared application's state.

An expiring snapshot arms the instance's alarm at `expiresAt` plus
`alarmGraceMs`, and only when `expiresAt` changes: an alarm write is billed
as a row written, and a counter's expiry changes once per window, not once
per call. `alarm()` deletes the storage of an expired snapshot.
