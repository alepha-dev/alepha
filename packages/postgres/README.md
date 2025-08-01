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

Provides PostgreSQL (and SQLite!) database integration with type-safe ORM capabilities through Drizzle.

The postgres module enables declarative database operations using descriptors like `$entity`, `$repository`.
It offers automatic schema generation, type-safe queries, transactions,
and database migrations with support for PostgreSQLs.

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


