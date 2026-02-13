# $circuit

## Import

```typescript
import { $circuit } from "alepha/server";
```

## Overview

* Consecutive failures before opening the circuit.
   */
  threshold: number;

  /**
   * Cooldown before transitioning from open to half-open.
   */
  reset: DurationLike;
}

/**
Middleware that implements the circuit breaker pattern.

Three states:
- **Closed** (normal) — calls pass through. Failures are counted.
- **Open** (tripped) — calls are immediately rejected. No handler execution.
- **Half-open** (probing) — one call is allowed. Success closes, failure re-opens.

```typescript
class PaymentController {
  charge = $action({
    use: [$circuit({ threshold: 5, reset: [30, "seconds"] })],
    handler: async ({ body }) => this.paymentGateway.charge(body),
  });
}
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `threshold` | `number` | Yes | Consecutive failures before opening the circuit. |
| `reset` | `DurationLike` | Yes | Cooldown before transitioning from open to half-open. |

