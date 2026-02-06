# $cache

> Creates a cache primitive for high-performance data caching with automatic management.

## Import

```typescript
import { $cache } from "alepha/cache";
```

## Overview

Creates a cache primitive for high-performance data caching with automatic management.

Provides a caching layer that improves application performance by storing frequently accessed
data in memory or external stores like Redis, with support for both function result caching
and manual cache operations.

**Key Features**
- Automatic function result caching based on input parameters
- Multiple storage backends (in-memory, Redis, custom providers)
- Intelligent serialization for JSON, strings, and binary data
- Configurable TTL with automatic expiration
- Pattern-based cache invalidation with wildcard support
- Environment controls to enable/disable caching

**Storage Backends**
- Memory: Fast in-memory cache (default for development)
- Redis: Distributed cache for production environments
- Custom providers: Implement your own storage backend

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | The cache name |
| `handler` | `Object` | No | Function which returns cached data. |
| `key` | `Object` | No | The key generator for the cache |
| `provider` | `InstantiableClass&lt;CacheProvider&gt; \| "memory"` | No | The store provider for the cache |
| `ttl` | `DurationLike` | No | The time-to-live for the cache in seconds |
| `disabled` | `boolean` | No | If the cache is disabled. |

## Examples

```ts
class DataService {
  // Function result caching
  getUserData = $cache({
    name: "user-data",
    ttl: [10, "minutes"],
    handler: async (userId: string) => {
      return await database.users.findById(userId);
    }
  });

  // Manual cache operations
  sessionCache = $cache<UserSession>({
    name: "sessions",
    ttl: [1, "hour"]
  });

  async storeSession(id: string, session: UserSession) {
    await this.sessionCache.set(id, session);
  }

  async invalidateUserSessions(userId: string) {
    await this.sessionCache.invalidate(`user:${userId}:*`);
  }
}
```

