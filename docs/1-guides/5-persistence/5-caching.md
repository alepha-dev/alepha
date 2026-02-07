# Caching

`$cache` provides a caching system with two modes: automatic function result caching and manual key-value store operations. In-memory by default, with Redis support for distributed environments.

```typescript
import { $cache } from "alepha/cache";
```

## Function Result Caching

Define a cache with a `handler` function. The return value is automatically cached based on the input arguments.

```typescript
import { $cache } from "alepha/cache";

class UserService {
  getUserData = $cache({
    name: "user-data",
    ttl: [10, "minutes"],
    handler: async (userId: string) => {
      return await this.repo.findById(userId);
    },
  });
}
```

Call it like a regular function. The first call executes the handler and caches the result. Subsequent calls with the same arguments return the cached value until the TTL expires.

```typescript
const user = await this.getUserData("some-uuid");
```

The cache key is derived from the function arguments by default (via `JSON.stringify`). If the handler throws an error, the result is not cached.

## Manual Store Operations

Omit the `handler` to use the cache as a manual key-value store.

```typescript
class SessionService {
  sessions = $cache({ name: "sessions", ttl: [1, "hour"] });

  async store(id: string, data: any) {
    await this.sessions.set(id, data);
  }

  async get(id: string) {
    return await this.sessions.get(id);
  }

  async clear(id: string) {
    await this.sessions.invalidate(id);
  }
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `ClassName:propertyKey` | Cache namespace. Keys are stored as `cache:<name>:<key>` |
| `handler` | `Function` | - | Function whose results are cached automatically |
| `ttl` | `DurationLike` | `[300, "seconds"]` (5 min) | Time-to-live. Set `0` to disable expiration |
| `key` | `Function` | `JSON.stringify(args)` | Custom key generator from handler arguments |
| `provider` | `Class` or `"memory"` | Injected `CacheProvider` | Override the cache backend |
| `compress` | `boolean` | `false` | Enable gzip compression (60-80% size reduction) |
| `disabled` | `boolean` | `false` | Disable caching entirely |

### TTL Format

TTL accepts a `DurationLike` tuple: `[amount, unit]`.

```typescript
ttl: [30, "seconds"]
ttl: [10, "minutes"]
ttl: [1, "hour"]
ttl: [7, "days"]
```

The default TTL is 5 minutes (300 seconds). This can be overridden globally via the `CACHE_DEFAULT_TTL` environment variable (in seconds).

## Methods

### run

Execute the handler function with caching. This is what gets called when you invoke the cache as a function. Only available when a `handler` is defined.

```typescript
const result = await this.getUserData("some-uuid");
// equivalent to:
const result = await this.getUserData.run("some-uuid");
```

### get

Retrieve a cached value by key. Returns `undefined` if the key does not exist or has expired.

```typescript
const value = await this.sessions.get("session-123");
```

### set

Store a value in the cache with an optional TTL override.

```typescript
await this.sessions.set("session-123", sessionData);
await this.sessions.set("session-123", sessionData, [30, "minutes"]);
```

### invalidate

Remove one or more keys from the cache. Supports pattern-based invalidation with a trailing wildcard `*`.

```typescript
// Invalidate a specific key
await this.sessions.invalidate("session-123");

// Invalidate multiple keys
await this.sessions.invalidate("session-123", "session-456");

// Pattern-based invalidation: delete all keys starting with "user:"
await this.cache.invalidate("user:*");
```

Calling `invalidate()` with no arguments deletes all entries in the cache's namespace.

### incr

Atomically increment a numeric value. If the key does not exist, it is set to 0 before incrementing.

```typescript
const newCount = await this.counter.incr("page-views", 1);
```

### key

Get the cache key that would be generated for the given arguments (useful for debugging).

```typescript
const cacheKey = this.getUserData.key("some-uuid");
```

## Custom Key Generation

Override the default key derivation:

```typescript
getUserData = $cache({
  name: "user-data",
  ttl: [10, "minutes"],
  key: (userId: string) => `user:${userId}`,
  handler: async (userId: string) => {
    return await this.repo.findById(userId);
  },
});
```

## Compression

Enable gzip compression for cached values to reduce storage size. Useful for large JSON payloads.

```typescript
largeData = $cache({
  name: "large-data",
  ttl: [1, "hour"],
  compress: true,
  handler: async () => {
    return await this.repo.findMany({});
  },
});
```

Compression adds CPU overhead but reduces storage by 60-80% for typical JSON data.

## Redis Backend

By default, caching uses in-memory storage (`MemoryCacheProvider`). For distributed caching across multiple instances, switch to Redis.

### Module Registration

```typescript
import { AlephaCacheRedis } from "alepha/cache/redis";

const alepha = Alepha.create().with(AlephaCacheRedis);
```

`AlephaCacheRedis` automatically registers `RedisCacheProvider` as the `CacheProvider` implementation and includes the base `AlephaCache` module.

### Direct Provider Override

```typescript
import { AlephaCache, CacheProvider } from "alepha/cache";
import { RedisCacheProvider } from "alepha/cache/redis";

const alepha = Alepha.create()
  .with(AlephaCache)
  .with({ provide: CacheProvider, use: RedisCacheProvider });
```

### Redis Key Prefix

Set `REDIS_CACHE_PREFIX` in your environment to add a prefix to all Redis cache keys. Useful for multi-tenant applications or isolating test environments.

## Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CACHE_ENABLED` | `boolean` | `true` | Enable or disable all caching globally |
| `CACHE_DEFAULT_TTL` | `number` | `300` | Default TTL in seconds |
| `REDIS_CACHE_PREFIX` | `string` | - | Prefix for all Redis cache keys |

## Serialization

The cache automatically handles serialization:

- **JSON values**: Serialized with `JSON.stringify` / `JSON.parse`
- **Strings**: Stored as raw UTF-8
- **Uint8Array**: Stored as raw binary

The serialization format is detected automatically during deserialization based on a type byte prefix.
