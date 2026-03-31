# $throttle

## Import

```typescript
import { $throttle } from "alepha/datetime";
```

## Overview

Middleware that rate-controls handler execution using a token bucket.

Excess calls are **delayed** until capacity is available — never rejected.
Process-local (not distributed). Use `$rateLimit` for distributed rate limiting.

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

