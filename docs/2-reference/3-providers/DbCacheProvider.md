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

