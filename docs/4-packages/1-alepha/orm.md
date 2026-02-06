# Alepha - Orm

## Installation

Part of the `alepha` package. Import from `alepha/orm`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.1.0 | node, bun, workerd|

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

- [`$entity`](/docs/primitives-$entity) — Creates a database entity primitive that defines table structure using TypeBox schemas.
- [`$repository`](/docs/primitives-$repository) — Get the repository for the given entity.
- [`$sequence`](/docs/primitives-$sequence) — Creates a PostgreSQL sequence primitive for generating unique numeric values.
- [`$transaction`](/docs/primitives-$transaction) — Creates a transaction primitive for database operations requiring atomicity and consistency.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_URL` | text | - |  |
| `POSTGRES_SCHEMA` | text | - |  |
