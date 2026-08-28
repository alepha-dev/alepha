# Caching

`$cache` provides a caching system with two modes: automatic function result caching and manual key-value store operations. In-memory by default, with Redis support for distributed environments.

```typescript check
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

| Option     | Type                  | Default                    | Description                                              |
| ---------- | --------------------- | -------------------------- | -------------------------------------------------------- |
| `name`     | `string`              | `ClassName:propertyKey`    | Cache namespace. Keys are stored as `cache:<name>:<key>` |
| `handler`  | `Function`            | -                          | Function whose results are cached automatically          |
| `ttl`      | `DurationLike`        | `[300, "seconds"]` (5 min) | Time-to-live. Set `0` to disable expiration              |
| `key`      | `Function`            | `JSON.stringify(args)`     | Custom key generator from handler arguments              |
| `provider` | `Class` or `"memory"` | Injected `CacheProvider`   | Override the cache backend                               |
| `compress` | `boolean`             | `false`                    | Enable gzip compression (60-80% size reduction)          |
| `disabled` | `boolean`             | `false`                    | Disable caching entirely                                 |
| `memory`   | `true` or options     | off                        | Add an in-process L1 memory tier in front of `provider`  |
| `stale`    | `DurationLike`        | off                        | Stale-while-revalidate window after `ttl` expires        |

### L1 Memory Tier

`memory: true` puts a process-local memory cache in front of the provider. Reads check memory first and fall back to the provider on miss; writes go to both tiers, so your own writes are immediately visible. Each process/isolate has its own L1 - `invalidate()` clears the local L1 plus the remote provider, but other processes keep their L1 until its TTL expires, so use a short L1 TTL to bound the staleness window.

### Stale-While-Revalidate

With `stale` set, a value that outlived its `ttl` remains servable for the `stale` window: reads return the stale value immediately and trigger one background refresh (single-flight per key). Requires a `handler`, since the cache needs to know how to recompute.

```typescript
getPrices = $cache({
  ttl: [1, "minute"],
  stale: [10, "minutes"],
  memory: true,
  handler: async () => this.fetchPrices(),
});
```

### TTL Format

TTL accepts a `DurationLike` tuple: `[amount, unit]`.

```typescript
ttl: [30, "seconds"];
ttl: [10, "minutes"];
ttl: [1, "hour"];
ttl: [7, "days"];
```

The default TTL is 5 minutes (300 seconds). It can be overridden globally via the `cacheOptions` atom:

```typescript
import { cacheOptions } from "alepha/cache";

alepha.store.mut(cacheOptions, (c) => ({ ...c, defaultTtl: 600 }));
```

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

A counter gets a lifetime the same way a cached value does: the per-call `ttl`, else the cache's `ttl`, else the container-wide `defaultTtl` (300 seconds). Only the _creation_ applies it, so the window is fixed rather than sliding and a counter cannot be held open by the very traffic it is meant to throttle.

```typescript
// Fixed 15-minute window, whatever the container default is.
const attempts = await this.counter.incr("login:1.2.3.4", 1, [15, "minutes"]);

// Never expires. Say so explicitly - the default is not "forever".
const total = await this.counter.incr("lifetime-signups", 1, 0);
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

Memory and Redis are not the only backends: on Cloudflare Workers the default is `CloudflareKVProvider` (backed by Workers KV), and `DatabaseCacheProvider` stores entries in the app's own database - useful when you want durable caching with no extra infrastructure.

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

Set a prefix for all Redis cache keys via the `redisCacheOptions` atom - useful for multi-tenant applications or isolating test environments:

```typescript
import { redisCacheOptions } from "alepha/cache/redis";

alepha.store.mut(redisCacheOptions, () => ({ prefix: "tenant-a" }));
```

## Global Configuration

Caching is configured through state atoms, not environment variables:

| Atom                | Field        | Default | Description                            |
| ------------------- | ------------ | ------- | -------------------------------------- |
| `cacheOptions`      | `enabled`    | `true`  | Enable or disable all caching globally |
| `cacheOptions`      | `defaultTtl` | `300`   | Default TTL in seconds                 |
| `redisCacheOptions` | `prefix`     | -       | Prefix for all Redis cache keys        |

```typescript
import { cacheOptions } from "alepha/cache";

alepha.store.mut(cacheOptions, (c) => ({ ...c, enabled: false }));
```

## Serialization

The cache automatically handles serialization:

- **JSON values**: Serialized with `JSON.stringify` / `JSON.parse`
- **Strings**: Stored as raw UTF-8
- **Uint8Array**: Stored as raw binary

The serialization format is detected automatically during deserialization based on a type byte prefix.
