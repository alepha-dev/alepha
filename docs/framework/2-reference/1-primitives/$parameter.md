# $parameter

## Import

```typescript
import { $parameter } from "alepha/api/parameters";
```

## Overview

Declares a named, schema-validated runtime parameter — configuration that
lives in the database, is editable from the admin UI, and is versioned with
`rollback()`. Read it with `get()`; every change records who made it.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | Parameter name using dot notation for tree hierarchy |
| `description` | `string` | No | Human-readable description of the parameter. |
| `schema` | `T` | Yes | Zod schema defining the parameter structure. |
| `default` | `Infer&lt;T&gt;` | Yes | Default value used when no parameter exists in database. |
| `migrate` | `Object` | No | Optional migration function for schema changes |

## Examples

```typescript
class FeatureFlags {
  checkout = $parameter({
    name: "checkout.flags",
    schema: z.object({ oneClick: z.boolean() }),
    default: { oneClick: false },
  });

  async isOneClickEnabled() {
    return (await this.checkout.get()).oneClick;
  }
}
```

