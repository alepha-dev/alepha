# $actor

## Import

```typescript
import { $actor } from "alepha/actor";
```

## Overview

Declare independent default and keyed actor state from an atom descriptor.

Methods are pure synchronous reducers of readonly JSON state and arguments.
Calls resolve to detached committed state. get(key) is synchronous; read()
lazily initializes state. Actor snapshots never synchronize with alepha.store.
Redis can rerun reducers on definite conflicts, so reducers must have no I/O,
mutable captured dependencies, time/random reads or other side effects.
