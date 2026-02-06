# Caching

The fastest database query is the one you don't make.

Caching in most tools involves Redis setup, serialization headaches, and cache invalidation bugs that haunt you at 3 AM. Alepha makes it boring — in a good way.

## The `$cache` Primitive

Cache a function's result. That's it.

```typescript
import { $cache } from "alepha/cache";

class ProductService {
  getPopularProducts = $cache({
    name: "popular-products",
    ttl: [10, "minutes"],
    handler: async () => {
      // This runs once per 10 minutes
      return await this.repo.findMany({
        orderBy: "-sales",
        limit: 100,
      });
    },
  });
}
```

First call: runs the handler, stores result, returns it.
Next calls (within TTL): returns cached result instantly. No database hit.

> **Module-level primitive**
>
> Like `$entity`, `$cache` is typically defined at module level or as a class property. The cache name should be unique across your app.

## Caching with Arguments

Most caches depend on input. No problem — arguments become part of the cache key automatically.

```typescript
class UserService {
  getUserProfile = $cache({
    name: "user-profile",
    ttl: [5, "minutes"],
    handler: async (userId: string) => {
      return await this.repo.findById(userId);
    },
  });
}

// Usage
const profile = await this.getUserProfile("user-123");
const other = await this.getUserProfile("user-456");
// Cached separately — different keys
```

> **Cache Key Generation**
>
> Alepha serializes your arguments to build the cache key. Works with strings, numbers, objects — anything JSON-serializable.

## TTL Syntax

Human-readable durations. No more mental math with milliseconds.

```typescript
ttl: [30, "seconds"]
ttl: [5, "minutes"]
ttl: [1, "hour"]
ttl: [7, "days"]
```

## Manual Cache Control

Sometimes you don't want a handler. You just want a typed key-value store.

```typescript
class SessionService {
  // Define cache without handler
  sessions = $cache<UserSession>({
    name: "sessions",
    ttl: [1, "hour"],
  });

  async createSession(userId: string): Promise<string> {
    const sessionId = crypto.randomUUID();
    const session = { userId, createdAt: Date.now() };

    await this.sessions.set(sessionId, session);
    return sessionId;
  }

  async getSession(sessionId: string): Promise<UserSession | null> {
    return await this.sessions.get(sessionId);
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.sessions.delete(sessionId);
  }
}
```

> **Type Safety**
>
> The generic `$cache<UserSession>` gives you full type safety on `get`, `set`, and `delete`. No `any` types leaking through.

## Cache Invalidation

The hardest problem in computer science. But not that hard.

### Invalidate by Key

```typescript
// User updated their profile? Clear their cache.
await this.getUserProfile.invalidate("user-123");
```

### Invalidate by Pattern

```typescript
// Clear all sessions for a user
await this.sessions.invalidate("user:*:sessions");
```

### Invalidate on Write

The most common pattern: clear cache when data changes.

```typescript
class UserService {
  getUserProfile = $cache({
    name: "user-profile",
    ttl: [5, "minutes"],
    handler: async (userId: string) => {
      return await this.repo.findById(userId);
    },
  });

  async updateProfile(userId: string, data: UpdateData) {
    await this.repo.updateById(userId, data);

    // Don't forget this part
    await this.getUserProfile.invalidate(userId);
  }
}
```

> **Invalidation is Explicit**
>
> Alepha doesn't auto-invalidate. You control when cache clears. This is intentional — implicit invalidation leads to surprising behavior.

## HTTP Response Caching

For API responses, use the `cache` option on actions. This sets proper HTTP headers (`Cache-Control`, `ETag`) so browsers and CDNs can cache too.

```typescript
class ProductApi {
  // Cache the entire HTTP response
  listProducts = $action({
    path: "/products",
    cache: true,
    handler: async () => {
      return await this.repo.findMany();
    },
  });

  // Custom TTL
  getProduct = $action({
    path: "/products/:id",
    cache: { ttl: [30, "seconds"] },
    handler: async ({ params }) => {
      return await this.repo.findById(params.id);
    },
  });
}
```

### ETag Support

Alepha automatically generates ETags. You write zero code for this.

```
# First request
GET /products/123
→ 200 OK
→ ETag: "abc123"

# Second request with ETag
GET /products/123
If-None-Match: "abc123"
→ 304 Not Modified (no body, saves bandwidth)
```

## Storage Backends

### Memory (Default)

Stored in process memory. Lost on restart. Perfect for development.

```typescript
// Just works, no config
const cache = $cache({
  name: "my-cache",
  ttl: [10, "minutes"],
  handler: async () => { /* ... */ },
});
```

Good for: development, single-instance apps, short-lived data.

### Redis

For production. Survives restarts. Shared across instances.

```typescript
// src/main.server.ts
import { run } from "alepha";
import { AlephaCacheRedis } from "alepha/cache/redis";
import { ApiModule } from "./api/index.ts";

const alepha = Alepha.create();

alepha.with(AlephaCacheRedis);

run(ApiModule);
```

Set `REDIS_URL` in your environment:

```bash
REDIS_URL=redis://localhost:6379
```

Your cache code stays exactly the same. Only the storage backend changes.

> **Zero Code Changes**
>
> Switch from memory to Redis without touching your cache logic. That's the point of the provider abstraction.

## Cache Warming

Pre-populate cache on startup. First users don't wait for cold cache.

```typescript
class CacheWarmer {
  products = $inject(ProductService);

  warmup = $hook({
    on: "ready",
    handler: async () => {
      // Pre-fetch into cache
      await this.products.getPopularProducts();

      for (const cat of ["electronics", "clothing", "home"]) {
        await this.products.getByCategory(cat);
      }
    },
  });
}
```

## Stampede Prevention

When cache expires, you don't want 1000 requests all hitting the database simultaneously. Alepha handles this automatically.

```typescript
getExpensiveData = $cache({
  name: "expensive",
  ttl: [1, "minute"],
  handler: async () => {
    // Only runs ONCE even if 1000 requests hit at the same time
    // Others wait for the first one to finish
    return await this.heavyComputation();
  },
});
```

> **Built-in Locking**
>
> While one request computes the value, others wait. No thundering herd problem.

## Common Patterns

### Cache Aside (Default)

Check cache → miss → compute → store → return.

This is what `$cache` does internally. You don't need to implement it yourself.

```typescript
// This is verbose and error-prone
async getUser(id: string) {
  const cached = await cache.get(id);
  if (cached) return cached;

  const user = await this.repo.findById(id);
  await cache.set(id, user);
  return user;
}

// Just use $cache instead
getUser = $cache({
  name: "users",
  ttl: [5, "minutes"],
  handler: (id) => this.repo.findById(id),
});
```

### Write Through

Update cache immediately when writing. Keeps cache fresh.

```typescript
async updateUser(id: string, data: UpdateData) {
  const user = await this.repo.updateById(id, data);

  // Update cache with fresh data instead of invalidating
  await this.userCache.set(id, user);

  return user;
}
```

## When NOT to Cache

Not everything benefits from caching.

- **Highly personalized data** — Cache hit rate will be terrible
- **Frequently changing data** — You'll invalidate more than you cache
- **Security-sensitive data** — Stale auth state is dangerous
- **Write-heavy workloads** — Invalidation overhead exceeds benefits

## Tips

1. **Start without caching** — Add it when you have actual performance data
2. **Cache at the right layer** — Usually database results, not API responses
3. **Use short TTLs initially** — Increase when you're confident
4. **Monitor hit rates** — A cache that never hits is just overhead
5. **Test invalidation** — Stale data causes subtle, maddening bugs

## Quick Reference

| Need | Solution |
|------|----------|
| Cache function results | `$cache({ handler })` |
| Manual cache control | `$cache()` + `set/get/delete` |
| HTTP response caching | `$action({ cache: true })` |
| Invalidate specific key | `cache.invalidate(key)` |
| Invalidate by pattern | `cache.invalidate("pattern:*")` |
| Production (Redis) | `alepha.with(AlephaCacheRedis)` |

Caching doesn't have to be complicated. Define TTL, define handler, move on with your life.
