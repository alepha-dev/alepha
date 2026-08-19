# Alepha - Cache Database

## Installation

Part of the `alepha` package. Import from `alepha/cache/database`.

```bash
npm install alepha
```

## Overview

Plugin for Alepha Cache that stores entries in the application's SQL database.

Adds a `cache_entries` table and a `DatabaseCacheProvider`
implementation of `CacheProvider` that:

- reads/writes through the framework's ORM (Postgres, SQLite, D1, Bun);
- exposes an **atomic** `incr()` via `INSERT ... ON CONFLICT DO UPDATE`;
- filters expired rows on every read (lazy expiration);
- opportunistically sweeps a small batch of expired rows on writes
  (configurable via `databaseCacheOptions`).

**Module is opt-in.** Importing this module does not change the default
`CacheProvider` binding — pass `provider: DatabaseCacheProvider` explicitly
to the relevant `$cache(...)` calls, or rebind globally via
`alepha.with({ provide: CacheProvider, use: DatabaseCacheProvider })`.

## API Reference

### Providers

- [`DatabaseCacheProvider`](/docs/reference-providers-databasecacheprovider) — Cache provider backed by the application's SQL database.
