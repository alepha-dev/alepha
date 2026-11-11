# $webhook

## Import

```typescript
import { $webhook } from "alepha/api/webhooks";
```

## Overview

Declares an outbound webhook event: its name, what it means to a
third-party developer, and the schema of its data.

**Events are code, endpoints are data.** This declares what can be sent;
which URLs receive it is rows an operator manages (`webhook_endpoints`).
The declaration is also the documentation: the event catalog and the
`x-webhooks` section of the OpenAPI document are derived from every
`$webhook` in the container.

`send(data)` validates the data, and for every active endpoint subscribed
to the event writes one delivery row and pushes one
`system.webhooks.deliver` job. The receiver gets a signed POST
(Standard Webhooks), retried for about 24 hours.

**Semantics:** at-least-once and unordered; receivers dedup on the
`webhook-id` header.

## Options

| Option        | Type     | Required | Description                                                        |
| ------------- | -------- | -------- | ------------------------------------------------------------------ |
| `name`        | `string` | Yes      | The event's public name, dotted and lower case (`order.paid`)      |
| `description` | `string` | Yes      | One or two sentences a third-party developer reads in the catalog. |
| `schema`      | `T`      | Yes      | The schema of the event's `data`                                   |

## Examples

```ts
class OrderWebhooks {
  paid = $webhook({
    name: "order.paid",
    description: "An order was paid in full.",
    schema: z.object({ orderId: z.uuid(), total: z.number() }),
  });
}

await this.webhooks.paid.send({ orderId, total });
```
