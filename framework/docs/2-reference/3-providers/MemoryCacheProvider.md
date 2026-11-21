# MemoryCacheProvider

## Import

```typescript
import { MemoryCacheProvider } from "alepha/cache";
```

## Overview

Cache entries in this process's memory.

The default `CacheProvider` on Node and Bun when `REDIS_URL` is not set,
and what `$cache({ provider: "memory" })` resolves to whatever the default
is. Entries belong to one process and are lost when it exits.

Under test it also records its calls, so a spec can assert on cache
behavior without a backend.
