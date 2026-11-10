# $entity

## Import

```typescript
import { $entity } from "alepha/orm";
```

## Overview

Creates a database entity primitive that defines table structure using Zod schemas.

## Options

| Option        | Type                                                                                                       | Required | Description                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `name`        | `string`                                                                                                   | Yes      | The database table name that will be created for this entity |
| `schema`      | `T`                                                                                                        | Yes      | Zod schema defining the table structure and column types.    |
| `indexes`     | `Object`                                                                                                   | No       | Database indexes to create for query optimization.           |
| `foreignKeys` | `Array<{ name?: string; columns: Array<keyof Infer<T>>; foreignColumns: Array<() => EntityColumn<any>> }>` | No       | Foreign key constraints to maintain referential integrity.   |
| `constraints` | `Array<{ columns: Array<keyof Infer<T>>; name?: string; unique?: boolean \| {}; check?: SQL }>`            | No       | Additional table constraints for data validation             |

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
