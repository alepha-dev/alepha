# $memoize

## Import

```typescript
import { $memoize } from "alepha";
```

## Overview

* Maximum number of entries to keep in the cache.
   * When exceeded, the oldest entry is evicted (FIFO).
   *
   * @default 1000
   */
  max?: number;

  /**
   * Custom key function. Receives the handler's arguments.
   * By default, `JSON.stringify(args)` is used.
   */
  key?: (...args: any[]) => string;
}

/**
Lightweight in-process memoization middleware.

Caches handler results in a plain `Map` — no external store, no serialization,
no provider dependency. Process-local only. Entries live until eviction by capacity.

```typescript
class Api {
  getStats = $action({
    use: [$memoize({ max: 100 })],
    handler: async () => this.repo.aggregate(),
  });
}
```

> For more advanced caching, use `$cache` from "alepha/cache" instead — it supports TTL, invalidation, external stores (Redis).

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `max` | `number` | No | Maximum number of entries to keep in the cache |
| `key` | `Object` | No | Custom key function |

