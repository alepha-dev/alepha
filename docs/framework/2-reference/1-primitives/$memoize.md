# $memoize

## Import

```typescript
import { $memoize } from "alepha";
```

## Overview

Lightweight in-process memoization middleware.

Caches handler results in a plain `Map` - no external store, no serialization,
no provider dependency. Process-local only. Entries live until eviction by capacity.

```typescript
class Api {
  getStats = $action({
    use: [$memoize({ max: 100 })],
    handler: async () => this.repo.aggregate(),
  });
}
```

> For more advanced caching, use `$cache` from "alepha/cache" instead - it supports TTL, invalidation, external stores (Redis).

## Options

| Option | Type     | Required | Description                                    |
| ------ | -------- | -------- | ---------------------------------------------- |
| `max`  | `number` | No       | Maximum number of entries to keep in the cache |
| `key`  | `Object` | No       | Custom key function                            |
