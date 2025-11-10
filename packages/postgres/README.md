# Alepha Postgres

A type-safe SQL query builder and ORM using Drizzle.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Postgres client based on Drizzle ORM, Alepha type-safe friendly.

```ts
const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    name: t.text(),
    email: t.text(),
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

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaPostgres } from "alepha/postgres";

const alepha = Alepha.create()
	.with(AlephaPostgres);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $entity()

Creates a database entity descriptor that defines table structure using TypeBox schemas.

```ts
import { t } from "@alepha/core";
import { $entity } from "@alepha/postgres";

const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    name: t.text(),
    email: t.email(),
  }),
});
```

#### $repository()

Get the repository for the given entity.

#### $sequence()

Creates a PostgreSQL sequence descriptor for generating unique numeric values.

#### $transaction()

Creates a transaction descriptor for database operations requiring atomicity and consistency.

This descriptor provides a convenient way to wrap database operations in PostgreSQL
transactions, ensuring ACID properties and automatic retry logic for version conflicts.
It integrates seamlessly with the repository pattern and provides built-in handling
for optimistic locking scenarios with automatic retry on version mismatches.

**Important Notes**:
- All operations within the transaction handler are atomic
- Automatic retry on `PgVersionMismatchError` for optimistic locking
- Pass `{ tx }` option to all repository operations within the transaction
- Transactions are automatically rolled back on any unhandled error
- Use appropriate isolation levels based on your consistency requirements
