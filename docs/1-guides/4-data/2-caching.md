# Caching

The fastest database query is the one you don't make.

Caching in most frameworks involves Redis setup, serialization headaches, and cache invalidation bugs that haunt you at 3 AM. Alepha tries to make it boring.

## Basic Caching with `$cache`

The simplest use: cache a function's result.

```typescript
import { $cache } from "alepha/cache";

class ProductService {
  // cache expensive computation for 10 minutes
  getPopularProducts = $cache({
    name: "popular-products",
    ttl: [10, "minutes"],
    handler: async () => {
      // this runs only once per 10 minutes
      return await this.db.products.findMany({
        orderBy: { sales: "desc" },
        limit: 100,
      });
    },
  });
}
```

First call: runs the handler, stores result, returns it.
Next calls (within 10 min): returns cached result instantly.

## Caching with Arguments

Most caches depend on input parameters:

```typescript
class UserService {
  getUserProfile = $cache({
    name: "user-profile",
    ttl: [5, "minutes"],
    handler: async (userId: string) => {
      return await this.db.users.findById(userId);
    },
  });
}

// usage
const profile = await this.getUserProfile("user-123");
// cached separately for each userId
```

The cache key automatically includes the arguments. `getUserProfile("a")` and `getUserProfile("b")` are cached independently.

## Manual Cache Operations

Sometimes you need direct control:

```typescript
class SessionService {
  // define cache without handler
  sessions = $cache<UserSession>({
    name: "sessions",
    ttl: [1, "hour"],
  });

  async createSession(userId: string): Promise<string> {
    const sessionId = crypto.randomUUID();
    const session = { userId, createdAt: Date.now() };

    // manually set
    await this.sessions.set(sessionId, session);

    return sessionId;
  }

  async getSession(sessionId: string): Promise<UserSession | null> {
    // manually get
    return await this.sessions.get(sessionId);
  }

  async destroySession(sessionId: string): Promise<void> {
    // manually delete
    await this.sessions.delete(sessionId);
  }
}
```

## Cache Invalidation

The two hardest problems in computer science: cache invalidation and naming things.

### Invalidate by Key

```typescript
// delete specific entry
await this.getUserProfile.invalidate("user-123");
```

### Invalidate by Pattern

```typescript
// delete all entries matching pattern
await this.sessions.invalidate("user:*:sessions");
```

### Invalidate on Events

Common pattern: invalidate cache when data changes.

```typescript
class UserService {
  getUserProfile = $cache({
    name: "user-profile",
    ttl: [5, "minutes"],
    handler: async (userId: string) => {
      return await this.db.users.findById(userId);
    },
  });

  async updateProfile(userId: string, data: UpdateData) {
    await this.db.users.update(userId, data);

    // clear the cache for this user
    await this.getUserProfile.invalidate(userId);
  }
}
```

## HTTP Response Caching

For API responses, use the `cache` option on actions:

```typescript
class ProductApi {
  // cache the entire HTTP response
  listProducts = $action({
    path: "/products",
    cache: true, // uses default settings
    handler: async () => {
      return await this.db.products.findMany();
    },
  });

  // with custom TTL
  getProduct = $action({
    path: "/products/:id",
    cache: { ttl: [30, "seconds"] },
    handler: async ({ params }) => {
      return await this.db.products.findById(params.id);
    },
  });
}
```

This sets proper HTTP headers (`Cache-Control`, `ETag`) so browsers and CDNs can cache too.

### ETag Support

Alepha automatically generates ETags for cached responses:

```typescript
// first request
GET /products/123
-> 200 OK
-> ETag: "abc123"

// second request with ETag
GET /products/123
If-None-Match: "abc123"
-> 304 Not Modified (no body, saves bandwidth)
```

You don't write any code for this. It just works.

## Storage Backends

### Memory (Default)

```typescript
// stored in process memory, lost on restart
const cache = $cache({
  name: "my-cache",
  ttl: [10, "minutes"],
  handler: async () => { /* ... */ },
});
```

Good for: development, single-instance apps, short-lived data.

### Redis

```typescript
import { RedisCacheProvider } from "alepha/cache/redis";

const alepha = Alepha.create()
  .with({ provide: CacheProvider, use: RedisCacheProvider });

// set REDIS_URL in your environment
```

Good for: production, multi-instance apps, persistent cache.

Your cache code stays the same. Only the provider changes.

## Cache Warming

Pre-populate cache on startup:

```typescript
class CacheWarmer {
  products = $inject(ProductService);

  warmup = $hook({
    on: "ready",
    handler: async () => {
      // pre-fetch popular products into cache
      await this.products.getPopularProducts();

      // pre-fetch top categories
      for (const cat of ["electronics", "clothing", "home"]) {
        await this.products.getByCategory(cat);
      }
    },
  });
}
```

First users don't wait for cold cache.

## Common Patterns

### Cache Aside

The default pattern. Check cache, if miss, compute and store.

```typescript
// this is what $cache does internally
async getUser(id: string) {
  const cached = await cache.get(id);
  if (cached) return cached;

  const user = await this.db.users.findById(id);
  await cache.set(id, user);
  return user;
}

// with $cache, just:
getUser = $cache({
  name: "users",
  ttl: [5, "minutes"],
  handler: (id) => this.db.users.findById(id),
});
```

### Write Through

Update cache when writing:

```typescript
async updateUser(id: string, data: UpdateData) {
  const user = await this.db.users.update(id, data);

  // update cache with fresh data
  await this.userCache.set(id, user);

  return user;
}
```

### Cache Stampede Prevention

When cache expires, you don't want 1000 requests all hitting the database. Alepha handles this:

```typescript
// only one request computes, others wait
getExpensiveData = $cache({
  name: "expensive",
  ttl: [1, "minute"],
  // implicit: lock while computing
  handler: async () => {
    // only runs once even if 1000 requests hit simultaneously
    return await this.heavyComputation();
  },
});
```

## Comparison: Redis Direct vs Alepha

**Redis directly:**
```typescript
const redis = new Redis();

async function getUser(id: string) {
  const cached = await redis.get(`user:${id}`);
  if (cached) return JSON.parse(cached);

  const user = await db.users.findById(id);
  await redis.setex(`user:${id}`, 300, JSON.stringify(user));
  return user;
}

// don't forget to invalidate...
async function updateUser(id: string, data: any) {
  await db.users.update(id, data);
  await redis.del(`user:${id}`);  // easy to forget
}
```

**Alepha:**
```typescript
getUser = $cache({
  name: "users",
  ttl: [5, "minutes"],
  handler: (id) => this.db.users.findById(id),
});

// invalidation is explicit, hard to miss
await this.getUser.invalidate(id);
```

Less boilerplate. Serialization handled. TTL is readable.

## When Not To Cache

- **Highly personalized data** - Cache hit rate will be low
- **Frequently changing data** - You'll invalidate more than you cache
- **Security-sensitive data** - Stale auth state is dangerous
- **Write-heavy operations** - Cache invalidation overhead

## Tips

1. **Start without caching** - Add it when you have performance data
2. **Cache at the right layer** - Database results, not API responses
3. **Use short TTLs initially** - Increase when confident
4. **Log cache hits/misses** - Monitor effectiveness
5. **Test invalidation** - Stale data causes subtle bugs

## Summary

| Need | Solution |
|------|----------|
| Cache function results | `$cache({ handler })` |
| Manual cache control | `$cache()` + `set/get/delete` |
| HTTP response caching | `$action({ cache: true })` |
| Pattern-based invalidation | `cache.invalidate("pattern:*")` |
| Production caching | Swap to `RedisCacheProvider` |

Caching doesn't have to be complicated. Define TTL, define handler, forget about it until you need to invalidate.
