# Pipelines and Resilience

Every primitive with a `handler` in Alepha is a pipeline: a handler with a list
of middleware wrapped around it. `$action`, `$job` and `$page` all extend the
same base, which is why they all take a `use` array, and `$pipeline` is that
base exposed on its own for the functions that are not any of those.

```typescript check
import { $pipeline } from "alepha";
```

That shared shape is what makes retries, timeouts, throttling and circuit
breaking one topic instead of four. Each is a middleware, each works anywhere a
`use` array does.

## `$pipeline`

Wrap a plain function and call it like a function:

```typescript check
import { $pipeline } from "alepha";
import { $retry } from "alepha/retry";
import { $timeout } from "alepha/datetime";

class OrderService {
  processOrder = $pipeline({
    use: [$retry({ max: 3 }), $timeout([30, "seconds"])],
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
method called from several places that should carry its retry policy with it
rather than have each caller remember one.

### Order in `use` is not cosmetic

The first middleware in the array is the outermost. `use: [A, B]` composes as
`A(B(handler))`, so A sees the call first and the result last.

This changes what the pair above means:

| Written as                     | Means                                        |
| ------------------------------ | -------------------------------------------- |
| `[$retry(...), $timeout(...)]` | Each attempt gets its own deadline           |
| `[$timeout(...), $retry(...)]` | One deadline covering every attempt together |

Both are reasonable. Only one is what you meant.

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

## The resilience middlewares

Six middlewares, all usable in any `use` array, all process-local unless the
table says otherwise.

| Middleware  | Import            | Protects against                            | On excess                |
| ----------- | ----------------- | ------------------------------------------- | ------------------------ |
| `$retry`    | `alepha/retry`    | A dependency failing transiently            | Tries again with backoff |
| `$timeout`  | `alepha/datetime` | A dependency never answering                | Rejects                  |
| `$throttle` | `alepha/datetime` | Your own traffic overwhelming an API        | Delays                   |
| `$debounce` | `alepha/datetime` | A thundering herd on one expensive result   | Shares one execution     |
| `$circuit`  | `alepha/server`   | Hammering a dependency that is already down | Rejects immediately      |
| `$memoize`  | `alepha`          | Recomputing an identical answer             | Returns the cached value |

### `$retry`

```typescript check
import { $action } from "alepha/server";
import { $retry } from "alepha/retry";

class Payments {
  charge = $action({
    use: [
      $retry({
        max: 3,
        backoff: { initial: 500, factor: 2, jitter: true },
        maxDuration: [10, "seconds"],
        when: (error) => !error.message.includes("card_declined"),
      }),
    ],
    handler: async () => "charged",
  });
}
```

`max` counts attempts, not extra attempts: `max: 3` runs the handler up to three
times. `backoff` takes a fixed number of milliseconds or an exponential
configuration, and defaults to `{ initial: 200, factor: 2, jitter: true }`.
`maxDuration` caps the total elapsed time across every attempt.

`when` is the important one. Retrying a declined card is not resilience, it is
three declined cards: return `false` for errors that will never succeed.

Retries abort on application shutdown, so a stopping process does not sit in a
backoff sleep it will never wake from.

### `$timeout`

```typescript check
import { $pipeline } from "alepha";
import { $timeout } from "alepha/datetime";

class Orders {
  process = $pipeline({
    use: [$timeout([30, "seconds"])],
    handler: async (orderId: string) => orderId,
  });
}
```

The deadline rejects the promise. It does not cancel the underlying work, which
keeps running until whatever it is waiting on gives up, so pair it with an
`AbortSignal` where the dependency supports one.

It uses managed timeouts from `DateTimeProvider`, which means `travel()` moves
it in tests instead of forcing a real 30 second wait.

### `$throttle`

```typescript check
import { $action } from "alepha/server";
import { $throttle } from "alepha/datetime";

class Payments {
  charge = $action({
    use: [$throttle({ rate: 80, per: [1, "second"] })],
    handler: async () => "charged",
  });
}
```

A token bucket that **delays** excess calls rather than rejecting them, which is
what separates it from `$rateLimit`: throttling shapes your outbound traffic,
rate limiting refuses somebody else's inbound traffic.

Two limits worth knowing before you rely on it. It is process-local, so four
instances at `rate: 80` produce up to 320 calls per second at the API. And the
refill is re-checked only when a waiter wakes, so a burst of concurrent calls can
wake inside the same window and briefly exceed `rate`. Treat it as smoothing,
not as a quota you can promise a vendor.

### `$debounce`

```typescript check
import { $action } from "alepha/server";
import { $debounce } from "alepha/datetime";

class Search {
  query = $action({
    path: "/search",
    use: [
      $debounce({
        delay: [200, "ms"],
        key: (req: { query: { q: string } }) => req.query.q,
      }),
    ],
    handler: async ({ query }) => query.q,
  });
}
```

Concurrent calls sharing a key are coalesced into one execution, and every
caller receives that one result. The classic use is a cache expiring under load:
a hundred requests arrive for the same key, and one rebuild serves all of them.

There is no storage behind it. Once the handler settles the next call starts
fresh, and the key defaults to `JSON.stringify(args)`, which is rarely what you
want for a request object. Pass `key`.

### `$circuit`

```typescript check
import { $action } from "alepha/server";
import { $circuit } from "alepha/server";

class Payments {
  charge = $action({
    use: [$circuit({ threshold: 5, reset: [30, "seconds"] })],
    handler: async () => "charged",
  });
}
```

Three states. **Closed** passes calls through and counts consecutive failures.
At `threshold` it **opens** and rejects every call without touching the handler.
After `reset` it goes **half-open** and lets one call through: success closes it,
failure opens it again.

The point is not to protect you, it is to protect the thing you are calling. A
dependency that is failing under load recovers faster when the traffic stops.

### `$memoize`

```typescript check
import { $memoize } from "alepha";
import { $action } from "alepha/server";

class Stats {
  summary = $action({
    use: [$memoize({ max: 100 })],
    handler: async () => "42",
  });
}
```

A plain `Map`, FIFO eviction at `max` (default 1000), no TTL, no invalidation and
no sharing between processes. It stores the _promise_ immediately, so concurrent
calls for one key deduplicate, and it deletes the entry when the handler throws,
so failures are never cached.

Entries live until they are evicted. That is the whole design, and it is why
this is for values that do not go stale in a way that matters. Anything needing a
TTL, explicit invalidation or Redis wants
[`$cache`](/docs/guides-persistence-caching) instead.

## `$batch`

`$batch` is the odd one out: a primitive rather than a middleware, and it
changes the shape of the call rather than wrapping it. It exists for the case
where one call per item is wasteful and one call per hundred items is not.

```typescript check
import { z } from "alepha";
import { $batch } from "alepha/batch";

class Indexer {
  documents = $batch({
    schema: z.object({ id: z.uuid(), body: z.text() }),
    maxSize: 100,
    maxDuration: [2, "seconds"],
    concurrency: 2,
    handler: async (items) => {
      return items.map((item) => ({ id: item.id, indexed: true }));
    },
  });

  async index(id: string, body: string) {
    const ticket = await this.documents.push({ id, body });
    return this.documents.wait(ticket);
  }
}
```

`push()` validates the item against `schema`, queues it and returns a ticket
immediately. The handler runs when either `maxSize` items have accumulated or
`maxDuration` has elapsed, whichever comes first. `wait(ticket)` resolves with
that item's result once the batch it landed in has been processed.

| Option         | Effect                                                         |
| -------------- | -------------------------------------------------------------- |
| `maxSize`      | Flush once this many items are queued                          |
| `maxDuration`  | Flush after this long, even if the batch is not full           |
| `maxQueueSize` | `push()` throws past this many queued items in one partition   |
| `partitionBy`  | Group items into independent batches by key                    |
| `concurrency`  | How many handler invocations may run at once                   |
| `retry`        | Retry configuration for a failed batch, same shape as `$retry` |

`partitionBy` is what keeps a batch honest when items are not interchangeable:
partition by tenant and one tenant's flush never carries another tenant's rows.

`flush()` forces a partition (or all of them) without waiting, `status(ticket)`
reads an item's state without blocking, and `clearCompleted()` drops finished
items from memory. Call that last one periodically in a long-running process:
completed results are retained so that `wait()` can still answer, and nothing
evicts them for you.

## See also

- [Middlewares](/docs/guides-server-middlewares) for the server-side middleware
  that ships with `AlephaServer`
- [Caching](/docs/guides-persistence-caching) for `$cache`, which is what
  `$memoize` is not
- [Background Jobs](/docs/guides-server-background-jobs) for work that has to
  survive the process
