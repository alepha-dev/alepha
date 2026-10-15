# Rate limiting

`alepha/rate-limit` counts hits per key in fixed windows and refuses past a limit.
It is not tied to HTTP: a limiter is a class field you call from an action, a job,
a login flow or anything else. Counters are [actor state](/docs/guides-persistence-actors),
so they live wherever the app's actors live.

```typescript check
import { $rateLimit } from "alepha/rate-limit";

class Downloads {
  perUser = $rateLimit({
    name: "downloads:user",
    limit: 100,
    window: [1, "hours"],
  });

  async download(userId: string) {
    const result = await this.perUser.consume(userId);
    if (!result.allowed) return { retryAfterMs: result.retryAfterMs };
    // ... serve the file
    return {};
  }
}
```

## Consume and refund

`consume(input)` counts one hit and resolves a result:

| Result                                                                                   | When                                     |
| ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| `{ allowed: true, count, limit, remaining, resetAt, ticket }`                            | counted                                  |
| `{ allowed: false, reason: "limit", count, limit, remaining: 0, resetAt, retryAfterMs }` | the window is full                       |
| `{ allowed: false, reason: "store" \| "contention", limit }`                             | the store failed, under `deny` (default) |
| `{ allowed: true, reason: "store" \| "contention", limit }`                              | the store failed, under `allow`          |

Only a counted result has a `ticket`. `refund(ticket)` gives that hit back, in the
window it was counted in: once the window has rolled, a refund does nothing. Refund
the hits that should not count, for example a login that succeeded:

```typescript check
import { $rateLimit } from "alepha/rate-limit";

interface Attempt {
  realm: string;
  userId: string;
  max: number;
  windowMs: number;
}

class Login {
  account = $rateLimit({
    name: "login:account",
    limit: (input: Attempt) => input.max,
    window: (input: Attempt) => input.windowMs,
    key: (input: Attempt) => `${input.realm}:${input.userId}`,
  });

  async verify(attempt: Attempt, check: () => Promise<boolean>) {
    const result = await this.account.consume(attempt);
    if (!result.allowed) return false;
    const ok = await check();
    if (ok && result.ticket) await this.account.refund(result.ticket);
    return ok;
  }
}
```

`refund` never throws. A refund that fails is logged: it leaves the limiter stricter,
never weaker.

## Options

- `name`: unique per app, the counters' namespace. A second limiter with the same
  name throws at declaration, since it would share counters silently.
- `limit`: hits per window, a number or a function of the consume input.
- `window`: a duration (`60_000`, `[15, "minutes"]`) or a function of the input.
- `key`: the counter key within the limiter. Defaults to the input, which must then
  be a string.
- `onStoreError`, `onContention`: `"deny"` (default) or `"allow"`.
- `algorithm`: `"fixed"`, the only one built.

`limit`, `window` and `key` are synchronous. Load anything asynchronous, such as
realm settings, before calling `consume` and pass it in the input.

## As a middleware

`middleware()` turns a string-keyed limiter into a `use: [...]` entry for
`$action`, `$job` or `$pipeline`, counting one hit per call:

```typescript check
import { $rateLimit } from "alepha/rate-limit";
import { $action } from "alepha/server";

class Api {
  search = $rateLimit({ name: "api:search", limit: 60, window: 60_000 });

  find = $action({
    method: "GET",
    path: "/find",
    use: [this.search.middleware()],
    handler: async () => "ok",
  });
}
```

Declare the limiter as a field above the actions that use it. The key is
`key(...args)` when the middleware options give one, else `ip:<request.ip>`
inside an HTTP request, else `ip:global` (one bucket for every call, as for a
`$job`).

An allowed call sets `X-RateLimit-Limit`, `X-RateLimit-Remaining` and
`X-RateLimit-Reset` (epoch seconds). A full window or contention throws a `429`
with `Retry-After`; a store failure throws a `503` with no limit headers, since
an outage is not a limit the client exceeded.

`skipFailedRequests` refunds the hit when the handler throws (anything but an
`HttpError` below 400); `skipSuccessfulRequests` refunds it when the handler
succeeds, so only failures count, as on a login endpoint.

## Fixed windows

A window opens on the key's first hit and lasts `window`; the next hit after it
opens a new one. Past the limit the counter saturates: the first refused hit marks
the window full, and every later refusal leaves the state unchanged, so it writes
nothing. A flood against a locked key costs reads, not writes. A limit lowered
mid-window applies on the next hit. A refund after saturation brings the count back
under the limit, so one more hit is allowed.

Each window expires with its counter: the state carries `resetAt` as its actor
expiry, and every provider reclaims it (see [Expiry](/docs/guides-persistence-actors)).

## Fail closed

A counter store can fail: a Redis outage, a Durable Object RPC error, a corrupt
value. By default the limiter refuses (`deny`), and `consume` resolves rather than
rejects, with `reason: "store"`. A caller that should answer an outage differently
from a full window reads `reason`, for example to answer 503 instead of 429.
`ActorContentionError` (Redis compare-and-set exhausted on a hot key) is
`reason: "contention"` and is also denied by default. Pass `"allow"` when an
unthrottled call is better than a refused one, such as an update check from a
device. An allowed result under `allow` has no ticket: nothing was counted.

## Events and audits

Every refusal emits `rateLimit:consume:denied` with `{ name, key, reason }`. There
is no "threshold crossed" event: whether a hit crossed depends on whether the caller
compares before or after counting. Write lockout audits yourself from `count`, for
example when a failed attempt's ticket has `count === limit`.

## Topology

The limiter has no store of its own: it counts through `$actor`, so the actor
provider decides who shares a counter.

- **Memory** (Node and Bun without `REDIS_URL`) counts per process. It is right
  for one instance.
- **Redis** (Node and Bun with `REDIS_URL` set) shares counters across
  instances, with nothing to register.
- **Durable Objects** on workerd, one per counter key, through the `ALEPHA_ACTOR`
  binding the build generates.

No `REDIS_URL` means one instance. Nothing falls back to SQL for counters: an app
that scales out without it lets each instance count on its own, so a limit of five
becomes five per instance. An evicted counter resets its limit, so run that Redis
with `noeviction` ([one Redis for every role](/docs/guides-deployment-bare#one-redis-for-every-role)).
See [the topology rule](/docs/guides-persistence-actors).
