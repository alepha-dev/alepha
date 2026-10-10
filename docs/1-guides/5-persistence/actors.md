# Actor state

`alepha/actor` declares independent default and keyed state from an atom descriptor.
Node and Bun use volatile Memory per container. Actor snapshots do not synchronize
with the local atom store, SSR hydration, browser persistence or React subscriptions.

```typescript
import { $atom, z } from "alepha";
import { $actor } from "alepha/actor";

const counter = $atom({ name: "counter", schema: z.integer(), default: 0 });
class CounterService {
  counter = $actor({
    atom: counter,
    methods: {
      add: (state, amount: number = 1) => state + amount,
    },
  });
  async increment() {
    await this.counter.add();
    return this.counter.get("alice").add(2);
  }
}
```

`get(key)` is synchronous and requires a nonempty string. The default actor and
`get("default")` are separate instances. `read()` and method calls lazily initialize
state and return detached committed snapshots. Failed transitions preserve state.

Reducers must be deterministic synchronous functions with no I/O, time, randomness,
mutable captured dependencies or other side effects. They receive recursively readonly
state and detached arguments and return the next state. Only lossless JSON values are
supported; explicit undefined, nonfinite numbers, negative zero, sparse arrays,
accessors, class instances and cycles are rejected. Optional trailing arguments may
be omitted. Async schemas and Promise reducer results are unsupported. Stored schema
incompatibility fails closed without resetting to the default.
