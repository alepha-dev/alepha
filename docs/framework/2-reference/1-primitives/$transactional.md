# $transactional

## Import

```typescript
import { $transactional } from "alepha/orm";
```

## Overview

Middleware that wraps handler execution in a database transaction.

All Repository operations inside the handler automatically participate in
the transaction — no explicit `{ tx }` drilling required.

Nesting is safe: if the handler is already inside a `transactional()` block,
the outer transaction is reused.

```typescript
class OrderService {
  createOrder = $action({
    use: [$transactional()],
    handler: async ({ body }) => {
      await this.orders.create(body);      // auto-uses tx
      await this.audit.create({ ... });     // auto-uses tx
      // throw → auto rollback, return → auto commit
    },
  });
}
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `config` | `PgTransactionConfig` | No | PostgreSQL transaction configuration (isolation level, access mode, etc.). |

