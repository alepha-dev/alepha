# MemoryActorProvider

## Import

```typescript
import { MemoryActorProvider } from "alepha/actor";
```

## Overview

Volatile actor snapshots scoped to one container, serialized per identity.
Expired snapshots are reclaimed by a bounded sweep on every write.
