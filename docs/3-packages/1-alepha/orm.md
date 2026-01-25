# Alepha - Orm

## Installation

Part of the `alepha` package. Import from `alepha/orm`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | epic | stable |

Full-featured database abstraction built on Drizzle ORM with complete type safety.

**Features:**
- Define database entities with TypeBox schemas
- Automatic timestamps, soft deletes, and versioning columns
- Type-safe CRUD operations with filtering, pagination, sorting, and relationships
- Database transaction support with automatic rollback
- Auto-incrementing sequences for IDs
- PostgreSQL support (Node.js, Bun, Cloudflare Workers via pglite)
- SQLite support (Node.js, Bun, Cloudflare D1)
- Automatic schema sync for development/testing
- Drizzle Kit migrations for production
- Type-safe filters: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `like`, `between`
- JSONB column support
- Relationship joins

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $entity()

Creates a database entity primitive that defines table structure using TypeBox schemas.

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

#### $repository()

Get the repository for the given entity.

#### $sequence()

Creates a PostgreSQL sequence primitive for generating unique numeric values.

#### $transaction()

Creates a transaction primitive for database operations requiring atomicity and consistency.

This primitive provides a convenient way to wrap database operations in PostgreSQL
transactions, ensuring ACID properties and automatic retry logic for version conflicts.
It integrates seamlessly with the repository pattern and provides built-in handling
for optimistic locking scenarios with automatic retry on version mismatches.

**Important Notes**:
- All operations within the transaction handler are atomic
- Automatic retry on `PgVersionMismatchError` for optimistic locking
- Pass `{ tx }` option to all repository operations within the transaction
- Transactions are automatically rolled back on any unhandled error
- Use appropriate isolation levels based on your consistency requirements

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_URL` | text | - |  |
| `POSTGRES_SCHEMA` | text | - |  |
