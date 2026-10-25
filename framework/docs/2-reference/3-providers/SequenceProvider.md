# SequenceProvider

## Import

```typescript
import { SequenceProvider } from "alepha/orm";
```

## Overview

Portable, scoped numeric sequence provider - works identically on Postgres,
SQLite, and Cloudflare D1.

Implementation: a single `alepha_sequences` table holds one row per
`(name, scope)` pair. Every call to `advance` runs an
`INSERT ... ON CONFLICT (name, scope) DO UPDATE SET value = value + step`
with `RETURNING value`, which is atomic on every supported driver:

- **Postgres**: row-level lock on `ON CONFLICT DO UPDATE`.
- **SQLite / D1**: writes are serialized, atomic by construction.

The repository pattern is the same one used by `DatabaseCacheProvider.incr()`;
see that file for the proof-of-design.

Callers never instantiate this directly. They declare a `SequencePrimitive`
via `$sequence()` and call `.next(scope?)` on the primitive - this provider is
the engine behind that call.
