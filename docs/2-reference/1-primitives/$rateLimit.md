# $rateLimit

## Import

```typescript
import { $rateLimit } from "alepha/rate-limit";
```

## Overview

Declare a transport-agnostic, fail-closed rate limiter.

Counters are actor state (`alepha/actor`), so topology is the actor
provider's: Memory is one instance, Redis (once `REDIS_URL` is set) is
several, and a Durable Object on workerd. An app that runs several instances
without `REDIS_URL` counts per instance.

`consume(input)` counts one hit in a fixed window anchored on its first hit.
A counted result carries a `ticket`; `refund(ticket)` gives that hit back,
within the same window only, and never throws. A refused hit is not counted:
past the limit the counter saturates and a flood costs reads, not writes.

`limit`, `window` and `key` are numbers or synchronous functions of the
consume input: load anything asynchronous (realm settings) before consuming
and pass it in. A store error or `ActorContentionError` resolves a result
with `reason: "store" | "contention"`, refused under `deny` (the default for
both) or allowed uncounted under `allow`. `consume` never rejects for them.

Every refusal emits `rate-limit:consume:denied`. Callers audit lockouts
themselves from `count`: whether a hit "crossed" depends on whether they
compare before or after counting.

`middleware()` puts a string-keyed limiter in front of an `$action`, `$job`
or `$pipeline`: 429 on the limit, 503 on a store error.

## Examples

```ts check
import { $rateLimit } from "alepha/rate-limit";

interface Attempt {
  userId: string;
  max: number;
}

class Auth {
  account = $rateLimit({
    name: "login:account",
    limit: (input: Attempt) => input.max,
    window: [15, "minutes"],
    key: (input: Attempt) => input.userId,
  });

  async attempt(userId: string, ok: () => Promise<boolean>) {
    const result = await this.account.consume({ userId, max: 5 });
    if (!result.allowed) return false;
    if (!(await ok())) return false;
    if (result.ticket) await this.account.refund(result.ticket);
    return true;
  }
}
```
