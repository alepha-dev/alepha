# $timeout

## Import

```typescript
import { $timeout } from "alepha/datetime";
```

## Overview

Middleware that aborts handler execution if it exceeds a duration limit.

Uses `Promise.race` with a managed timeout from `DateTimeProvider` —
if the handler doesn't resolve before the deadline, the promise rejects.
Uses managed timeouts so it works with `DateTimeProvider.travel()` in tests.

```typescript
class OrderService {
  processOrder = $pipeline({
    use: [$timeout([30, "seconds"])],
    handler: async (orderId: string) => {
      return await this.orders.updateById(orderId, { status: "paid" });
    },
  });
}
```

