# $pipeline

## Import

```typescript
import { $pipeline } from "alepha";
```

## Overview

Creates a pipeline primitive that composes middleware with a handler.

It makes a big function which runs all functions (middleware) inside `use` array before and after the `handler` function.
The middleware functions are applied in the order they are defined in the `use` array.

So PipelinePrimitive is also a base for primitives with `handler` which need some sort of plugins.

Use `$pipeline` for standalone composition outside host primitives (`$action`, `$job`, `$page`).
Host primitives extend `PipelinePrimitive` directly to get middleware support.

```ts
class OrderService {
  processOrder = $pipeline({
    use: [$lock({ name: "process-order" }), $retry({ max: 3 })],
    handler: async (orderId: string) => {
      return await this.orders.updateById(orderId, { status: "paid" });
    },
  });
}
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `use` | `Middleware[]` | Yes |  |
| `handler` | `T` | Yes |  |

