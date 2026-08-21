# Alepha - Orm

## Installation

Part of the `alepha` package. Import from `alepha/orm`.

```bash
npm install alepha
```

## Overview

Type-safe data layer over Drizzle ORM.

**Features:**

- `$entity` schema definitions with Zod + `db` column helpers
- `Repository` CRUD, pagination, joins, and optimistic locking
- Introspection-based dev schema sync, file-based production migrations
- SQLite by default; Postgres via `alepha/orm/postgres`

## API Reference

### Primitives

- [`$entity`](/docs/reference-primitives-$entity) - Creates a database entity primitive that defines table structure using Zod schemas.
- [`$relations`](/docs/reference-primitives-$relations) - Declares how entities relate to one another.
- [`$repositories`](/docs/reference-primitives-$repositories) - One relation-aware repository per entity, in a single binding.
- [`$repository`](/docs/reference-primitives-$repository) - Get the repository for the given entity.
- [`$seed`](/docs/reference-primitives-$seed) - Activate seed mode: a convenience wrapper around `$mode` that runs the handler
- [`$sequence`](/docs/reference-primitives-$sequence) - Declare a portable, scoped numeric sequence.
- [`$transactional`](/docs/reference-primitives-$transactional) - Middleware that wraps handler execution in a database transaction.

### Providers

- [`DbCacheProvider`](/docs/reference-providers-dbcacheprovider) - Database query cache using a simple in-memory Map.
- [`SequenceProvider`](/docs/reference-providers-sequenceprovider) - Portable, scoped numeric sequence provider - works identically on Postgres,
- [`SqlExpressionProvider`](/docs/reference-providers-sqlexpressionprovider) - Dialect-neutral SQL expression builder.
