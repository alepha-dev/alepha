# $entity

## Import

```typescript
import { $entity } from "alepha/orm";
```

## Overview

Creates a database entity primitive that defines table structure using Zod schemas.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | Yes | The database table name that will be created for this entity |
| `schema` | `T` | Yes | Zod schema defining the table structure and column types. |
| `indexes` | `Object` | No | Database indexes to create for query optimization. |
| `foreignKeys` | `Array&lt;{` | No | Foreign key constraints to maintain referential integrity. |
| `constraints` | `Array&lt;{` | No | Additional table constraints for data validation |
| `config` | `Object` | No | Advanced Drizzle ORM configuration for complex table setups. |

## Examples

```ts
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

const userEntity = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
    email: z.email(),
  }),
});
```

