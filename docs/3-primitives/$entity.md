# $entity

> Creates a database entity primitive that defines table structure using TypeBox schemas.

## Import

```typescript
import { $entity } from "alepha/orm";
```

## Overview

Creates a database entity primitive that defines table structure using TypeBox schemas.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | Yes | The database table name that will be created for this entity |
| `schema` | `T` | Yes | TypeBox schema defining the table structure and column types. |
| `indexes` | `Object` | No | Database indexes to create for query optimization. |
| `column` | `Keys` | Yes | Single column to index. |
| `unique` | `boolean` | No | Whether this should be a unique index (enforces uniqueness constraint). |
| `name` | `string` | No | Custom name for the index |
| `columns` | `Keys[]` | Yes | Multiple columns for composite index (order matters for query optimization). |
| `unique` | `boolean` | No | Whether this should be a unique index (enforces uniqueness constraint). |
| `name` | `string` | No | Custom name for the index |
| `foreignKeys` | `Array&lt;{` | No | Foreign key constraints to maintain referential integrity. |
| `name` | `string` | No | Optional name for the foreign key constraint. |
| `columns` | `Array&lt;keyof Static&lt;T&gt;&gt;` | Yes | Local columns that reference the foreign table. |
| `foreignColumns` | `Array&lt;() =&gt; EntityColumn&lt;any&gt;&gt;` | Yes | Referenced columns in the foreign table |
| `constraints` | `Array&lt;{` | No | Additional table constraints for data validation |
| `columns` | `Array&lt;keyof Static&lt;T&gt;&gt;` | Yes | Columns involved in this constraint. |
| `name` | `string` | No | Optional name for the constraint. |
| `unique` | `boolean \| {} /* options */` | No | Whether this is a unique constraint. |
| `check` | `SQL` | No | SQL expression for check constraint validation. |
| `config` | `Object` | No | Advanced Drizzle ORM configuration for complex table setups. |
| `self` | `BuildExtraConfigColumns&lt;string, FromSchema&lt;T&gt;, "pg"&gt;` | Yes |  |

## Examples

```ts
import { t } from "alepha";
import { $entity } from "alepha/orm";

const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    name: t.text(),
    email: t.email(),
  }),
});
```

