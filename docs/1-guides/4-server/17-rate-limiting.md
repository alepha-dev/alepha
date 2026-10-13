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

Every refusal emits `rate-limit:consume:denied` with `{ name, key, reason }`. There
is no "threshold crossed" event: whether a hit crossed depends on whether the caller
compares before or after counting. Write lockout audits yourself from `count`, for
example when a failed attempt's ticket has `count === limit`.

## Topology

The limiter has no store of its own: it counts through `$actor`, so the actor
provider decides who shares a counter.

- **Memory** (the default on Node and Bun) counts per process. It is right for one
  instance.
- **Redis** (`alepha.with(AlephaActorRedis)` from `alepha/actor/redis`) shares
  counters across instances. `REDIS_URL` alone does not select it: an app that runs
  several instances with only a Redis cache still counts per instance.
- **Durable Objects** on workerd, one per counter key, through the `ALEPHA_ACTOR`
  binding the build generates.

No Redis means one instance. Nothing falls back to SQL for counters: an app that
scales out without `AlephaActorRedis` lets each instance count on its own, so a
limit of five becomes five per instance. See [the topology rule](/docs/guides-persistence-actors).
