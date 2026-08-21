# DatabaseCacheProvider

## Import

```typescript
import { DatabaseCacheProvider } from "alepha/cache/database";
```

## Overview

Cache provider backed by the application's SQL database.

Uses the `cache_entries` table as a generic key/value store with optional
TTL. Works on every database supported by Alepha's ORM (Postgres, SQLite,
Cloudflare D1, Bun SQLite).

**Why use this over Cloudflare KV / Redis ?**

- You already have a SQL database, no extra resource to provision/secure.
- `incr()` is **atomic** through `INSERT ... ON CONFLICT DO UPDATE`.
- Reads/writes are **strongly consistent** (KV is eventually consistent).
- Phase-2 flows (registration, password reset) become transactional with
  the user-creation INSERT.

**When to prefer Cloudflare KV / Redis instead ?**

- Hot read paths where DB latency matters.
- Very high write rates where DB pressure becomes a concern.

**Storage layout**

- `value` column: base64-encoded bytes for `set/get/setTyped/getTyped`.
- `count` column: integer counter for atomic `incr()`.
- `expiresAt` column: nullable timestamp; expired rows are filtered at read
  time and reaped opportunistically on writes.
