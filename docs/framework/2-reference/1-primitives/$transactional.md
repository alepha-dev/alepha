# $transactional

## Import

```typescript
import { $transactional } from "alepha/orm";
```

## Overview

Middleware that wraps handler execution in a database transaction.

All Repository operations inside the handler automatically participate in
the transaction - no explicit `{ tx }` drilling required.

Nesting is safe: if the handler is already inside a `transactional()` block,
the outer transaction is reused.

⚠️ **A no-op on a driver without transactions** (Cloudflare D1, PGlite):
the handler runs in place, and a throw rolls nothing back. Each primitive
logs one warning the first time it runs there. Code that must be correct on
D1 guards its writes instead: preconditions in the WHERE, `db.version()`,
or an order in which a failure leaves harmless state.

```typescript
class OrderService {
  createOrder = $action({
    use: [$transactional()],
    handler: async ({ body }) => {
      await this.orders.create(body);      // auto-uses tx
      await this.audit.create({ ... });     // auto-uses tx
      // throw → rollback, return → commit (not on D1: see above)
    },
  });
}
```

## Options

| Option   | Type                  | Required | Description                                                                |
| -------- | --------------------- | -------- | -------------------------------------------------------------------------- |
| `config` | `PgTransactionConfig` | No       | PostgreSQL transaction configuration (isolation level, access mode, etc.). |
