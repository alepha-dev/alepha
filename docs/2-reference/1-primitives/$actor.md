# $actor

## Import

```typescript
import { $actor } from "alepha/actor";
```

## Overview

Declare independent default and keyed actor state from an atom descriptor.

The atom supplies a stable name, schema and default, not live actor storage.
Node and Bun default to per-container Memory; Redis requires explicit selection
and a namespace. Workerd uses a native Durable Object and fails if unbound.
Browser and native client execution is unsupported.

Methods are pure synchronous reducers of readonly JSON state and arguments.
Calls resolve to detached committed state. get(key) is synchronous; read()
lazily initializes state. Actor snapshots never synchronize with alepha.store.
Redis can rerun reducers on definite conflicts, so reducers must have no I/O,
mutable captured dependencies, time/random reads or other side effects.
Arguments are captured before the call waits. Reducer inputs are recursively
frozen; callers may mutate returned snapshots without changing stored state.
Omit optional values instead of passing undefined. Invalid, thrown or Promise
transitions preserve state. Incompatible persisted data fails without resetting.
A transport error can leave the commit outcome unknown; delivery is not exactly
once. Changing a namespace or name selects new state without migrating old data.

## Examples

```ts check
import { $atom, Alepha, z } from "alepha";
import { $actor } from "alepha/actor";

const counter = $atom({ name: "counter", schema: z.integer(), default: 0 });
class Counters {
  value = $actor({
    atom: counter,
    methods: { add: (state, amount: number = 1) => state + amount },
  });
}
const counters = Alepha.create().inject(Counters);
await counters.value.add(); // default instance: 1
await counters.value.get("alice").add(2); // keyed instance: 2
await counters.value.read(); // default instance: 1
```
