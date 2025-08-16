# Alepha Postgres

A type-safe SQL query builder and ORM using Drizzle.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/postgres
```

## Module

Postgres client based on Drizzle ORM, Alepha type-safe friendly.

```ts
const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    name: t.string(),
    email: t.string(),
  }),
});

class Db {
  users = $repository(users);
}

const db = alepha.inject(Db);
const user = await db.users.one({ name: { eq: "John Doe" } });
```

This is not a full ORM, but rather a set of tools to work with Postgres databases in a type-safe way.

It provides:
- A type-safe way to define entities and repositories. (via `$entity` and `$repository`)
- Custom query builders and filters.
- Built-in special columns like `createdAt`, `updatedAt`, `deletedAt`, `version`.
- Automatic JSONB support.
- Automatic synchronization of entities with the database schema (for testing and development).
- Fallback to raw SQL via Drizzle ORM `sql` function.

Migrations are supported via Drizzle ORM, you need to use the `drizzle-kit` CLI tool to generate and run migrations.

> It's look like working with MongoDB, but with Postgres.

Relations are NOT SUPPORTED yet. If you need relations, please use the `drizzle-orm` package directly.

## API Reference

### Descriptors

#### $entity()

Declare a new entity in the database.
This descriptor alone does not create the table, it only describes it.
It must be used with `$repository` to create the table and perform operations on it.

This is a convenience function to create a table with a json schema.
For now, it creates a drizzle-orm table under the hood.
```ts
import { $entity } from "@alepha/postgres";

const User = $entity({
  name: "user",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    name: t.string(),
    email: t.string(),
  }),
  indexes: ["email"],
});
```

#### $repository()



#### $sequence()



#### $transaction()


