# Pipelines

Every primitive with a `handler` in Alepha is a pipeline: a handler with a list
of middleware wrapped around it. `$action`, `$job` and `$page` all extend the
same base, which is why they all take a `use` array, and `$pipeline` is that
base exposed on its own for the functions that are not any of those.

```typescript check
import { $pipeline } from "alepha";
```

That shared shape is what makes a middleware one topic instead of one per
primitive: each works anywhere a `use` array does.

## `$pipeline`

Wrap a plain function and call it like a function:

```typescript check
import { $pipeline } from "alepha";
import { $lock } from "alepha/lock";

class OrderService {
  processOrder = $pipeline({
    use: [$lock({ name: "process-order" })],
    handler: async (orderId: string) => {
      return { orderId, status: "paid" };
    },
  });

  async run(id: string) {
    return this.processOrder(id);
  }
}
```

Reach for it when the work is not a route, a job or a page: an internal service
method called from several places that should carry its middleware with it
rather than have each caller remember one.

### Order in `use` is not cosmetic

The first middleware in the array is the outermost. `use: [A, B]` composes as
`A(B(handler))`, so A sees the call first and the result last. A lock placed
before a cache middleware serialises the misses; placed after it, only the
handler is serialised and the cache answers concurrently. Both are reasonable.
Only one is what you meant.

## `$scope`

Host primitives run their handler inside an AsyncLocalStorage scope, which is
what makes `alepha.context.get()` and `.set()` work per request. A standalone
`$pipeline` has no such scope, so add one when the handler needs it:

```typescript check
import { $pipeline, $scope } from "alepha";

class OrderService {
  processOrder = $pipeline({
    use: [$scope()],
    handler: async (orderId: string) => {
      return orderId;
    },
  });
}
```

Adding `$scope()` to an `$action`, `$job` or `$page` throws, on purpose: you are
already inside a scope, and nesting one would give you a second, empty context
that silently loses everything the outer one held.

## See also

- [Middlewares](/docs/guides-server-middlewares) for the server-side middleware
  that ships with `AlephaServer`
- [Caching](/docs/guides-persistence-caching) for `$cache`
- [Background Jobs](/docs/guides-server-background-jobs) for work that has to
  survive the process, with its own durable retries
