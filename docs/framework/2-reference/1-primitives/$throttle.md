# $throttle

## Import

```typescript
import { $throttle } from "alepha/datetime";
```

## Overview

Middleware that rate-controls handler execution using a token bucket.

Excess calls are **delayed** until capacity is available - never rejected.
Process-local (not distributed) - it cannot rate-limit across instances.

**Limitation**: the token refill is time-based and re-checked only when a
waiter wakes, so a burst of *concurrent* calls can wake in the same window
and briefly exceed `rate`. Treat it as traffic smoothing, not a hard cap -
do not rely on it to enforce a strict quota.

**Use case**: protect an external API from your own traffic.

```typescript
class PaymentController {
  charge = $action({
    use: [$throttle({ rate: 80, per: [1, "second"] })],
    handler: async ({ body }) => this.stripe.charges.create(body),
  });
}
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `rate` | `number` | Yes | Max calls per window. |
| `per` | `DurationLike` | Yes | Window duration. |

