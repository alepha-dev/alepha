# DbCacheProvider

## Import

```typescript
import { DbCacheProvider } from "alepha/orm";
```

## Overview

Database query cache using a simple in-memory Map.

Uses `{tableName}:{cacheKey}` as the storage key.
Provides per-table invalidation for write-through cache busting.

This is intentionally self-contained (no external cache dependencies)
so the ORM module does not force `AlephaCache` on all consumers.

### Bounded on purpose

The key space is not: it is derived from the caller's query, so a query built
from user-controlled pagination or filter values mints a fresh entry per
distinct input. `expiresAt` was only ever consulted inside `get()`, so an
entry written once and never read again was reclaimed by nothing short of a
write to its table - never, for a read-mostly table. Two bounds close that:
expired entries are swept on write, and the map is capped at
`MAX_ENTRIES` with oldest-first eviction (insertion order).

