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

Creates a table descriptor for drizzle-orm.

#### $repository()



#### $transaction()


