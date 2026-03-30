# $cache

## Import

```typescript
import { $cache } from "alepha/cache";
```

## Overview

Creates a cache primitive for caching with automatic management.

**Middleware mode** (no `handler`) — usable in `use` arrays AND as a store:
```ts
class UserService {
  userCache = $cache({ name: "users", ttl: [10, "minutes"] });

  fetchUser = $pipeline({
    use: [this.userCache],
    handler: async (userId: string) => this.repo.getById(userId),
  });

  async invalidateUser(userId: string) {
    await this.userCache.invalidate(userId);
  }
}
```

**Primitive mode** (with `handler`) — standalone callable:
```ts
getUserData = $cache({
  name: "user-data",
  ttl: [10, "minutes"],
  handler: async (userId: string) => {
    return await database.users.findById(userId);
  }
});
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | The cache name |
| `handler` | `Object` | No | Function which returns cached data. |
| `key` | `Object` | No | The key generator for the cache |
| `provider` | `InstantiableClass&lt;CacheProvider&gt; \| "memory"` | No | The store provider for the cache |
| `ttl` | `DurationLike` | No | The time-to-live for the cache in seconds |
| `disabled` | `boolean` | No | If the cache is disabled. |
| `compress` | `boolean` | No | Enable gzip compression for cached values |

