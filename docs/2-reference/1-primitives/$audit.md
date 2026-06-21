# $audit

## Import

```typescript
import { $audit } from "alepha/api/audits";
```

## Overview

Create an audit type primitive.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `type` | `string` | Yes | Unique audit type identifier (e.g., "auth", "payment", "order"). |
| `description` | `string` | No | Human-readable description of this audit type. |
| `actions` | `string[]` | Yes | List of allowed actions for this audit type. |
| `retentionDays` | `number` | No | Number of days entries of this audit type are retained before the periodic cleanup job deletes them |

## Examples

```ts
class OrderAudits {
  audit = $audit({
    type: "order",
    description: "Order management events",
    actions: ["create", "update", "cancel", "fulfill", "ship"],
  });
}
```

