# Caching

`$cache` provides a caching system with two modes: automatic function result caching, and a key-value store that also works as a middleware. In-memory by default on Node and Bun, with Redis, database and Cloudflare backends.

> Server-rendered pages need none of this: the [page cache](/docs/guides-frontend-page-cache) caches every page that reads nothing about its visitor, automatically, and refuses a `$cache` in a page's `use`. Use `$cache` for the data a personal page's loader reads, keyed by user.

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

The cache key is derived from the function arguments by default (via `JSON.stringify`). If the handler throws an error, the result is not cached. Concurrent misses on the same key share one handler call (single-flight), and a failed cache write is logged, never thrown: the computed result is still returned.

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

### As a middleware

Without a `handler`, the cache is also a middleware: put it in the `use` array of a `$pipeline` (or anything that takes middlewares) and it caches that handler's result, with the same key derivation, single-flight and `stale` behavior. The same object remains a store, so it can invalidate what it cached:

```typescript
class UserService {
  userCache = $cache({ name: "users", ttl: [10, "minutes"] });

  fetchUser = $pipeline({
    use: [this.userCache],
    handler: async (userId: string) => this.repo.getById(userId),
  });

  async rename(userId: string, name: string) {
    await this.repo.updateById(userId, { name });
    await this.userCache.invalidate(JSON.stringify([userId]));
  }
}
```

A cache is a no-op until the container has started, when it is `disabled`, or when `cacheOptions.enabled` is `false`: reads miss, writes are dropped, and `incr` returns `amount`. The `enabled` getter tells you which, for code that uses the cache as infrastructure rather than as an optimisation.

## Options

| Option     | Type                  | Default                    | Description                                             |
| ---------- | --------------------- | -------------------------- | ------------------------------------------------------- |
| `name`     | `string`              | `ClassName:propertyKey`    | Cache namespace (the container part of every key)       |
| `handler`  | `Function`            | -                          | Function whose results are cached automatically         |
| `ttl`      | `DurationLike`        | `[300, "seconds"]` (5 min) | Time-to-live. Set `0` to disable expiration             |
| `key`      | `Function`            | `JSON.stringify(args)`     | Custom key generator from handler arguments             |
| `provider` | `Class` or `"memory"` | Injected `CacheProvider`   | Override the cache backend                              |
| `compress` | `boolean`             | `false`                    | Enable gzip compression (60-80% size reduction)         |
| `disabled` | `boolean`             | `false`                    | Disable caching entirely                                |
| `memory`   | `true` or options     | off                        | Add an in-process L1 memory tier in front of `provider` |
| `stale`    | `DurationLike`        | off                        | Stale-while-revalidate window after `ttl` expires       |

### L1 Memory Tier

`memory: true` puts a process-local memory cache in front of the provider. Reads check memory first and fall back to the provider on miss; writes go to both tiers, so your own writes are immediately visible. Each process/isolate has its own L1 - `invalidate()` clears the local L1 plus the remote provider, but other processes keep their L1 until its TTL expires, so use a short L1 TTL to bound the staleness window.

Pass an object instead of `true` to tune it: `ttl` (default the smaller of the cache's `ttl` and 30 seconds), `max` (LRU bound, default 500 entries) and `negative` (also remember provider misses for that duration, off by default).

### Stale-While-Revalidate

With `stale` set, a value that outlived its `ttl` remains servable for the `stale` window: reads return the stale value immediately and trigger one background refresh (single-flight per key). Requires a `handler`, or middleware mode, since the cache needs to know how to recompute.

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

By default, caching uses in-memory storage (`MemoryCacheProvider`). Set `REDIS_URL` and every instance shares one cache (`RedisCacheProvider`): there is no module to register. The same variable shares queue jobs, topics, locks and actors, so run that Redis with `noeviction`: see [one Redis for every role](/docs/guides-deployment-bare#one-redis-for-every-role).

Memory and Redis are not the only backends:

- `DatabaseCacheProvider` (`alepha/cache/database`, module `AlephaCacheDatabase`) stores entries in a `cache_entries` table of the app's own database, with an atomic `incr`. Registering the module does not change the default: pass `provider: DatabaseCacheProvider` to a `$cache`, or substitute it for `CacheProvider`.
- On Cloudflare Workers the default is `CloudflareCacheProvider`, which resolves at start to the database cache when the app has a database, and to `CloudflareKVProvider` (Workers KV) only when it does not. KV is eventually consistent, has a 60 second TTL floor, and its `incr` can lose an update under concurrency.

### Selection

```bash
REDIS_URL=redis://localhost:6379
```

`REDIS_URL` is read when `alepha/cache` registers: set and non-empty, the cache is `RedisCacheProvider`; absent, `MemoryCacheProvider`. An explicit substitution wins over both, so an app that sets `REDIS_URL` for its queue can keep this cache per instance:

```typescript
import { Alepha } from "alepha";
import { CacheProvider, MemoryCacheProvider } from "alepha/cache";

const alepha = Alepha.create().with({
  provide: CacheProvider,
  use: MemoryCacheProvider,
});
```

### Key Namespace

Redis and Cloudflare KV store every entry as `<alepha.name>:cache:<container>:<key>`, where [`alepha.name`](/docs/guides-core-alepha-instance) is `APP_NAME`, else the build's app name, else `"app"`. Two apps sharing one Redis or one KV namespace never read each other's entries, and `clear()` deletes the calling app's entries only. Set `APP_NAME` to keep two environments of one app apart:

```typescript
const alepha = Alepha.create({ env: { APP_NAME: "shop-staging" } });
```

The database cache is not namespaced: its `cache_entries` table lives in the app's own database.

## Global Configuration

Caching is configured through state atoms, not environment variables:

| Atom           | Field        | Default | Description                            |
| -------------- | ------------ | ------- | -------------------------------------- |
| `cacheOptions` | `enabled`    | `true`  | Enable or disable all caching globally |
| `cacheOptions` | `defaultTtl` | `300`   | Default TTL in seconds                 |

```typescript
import { cacheOptions } from "alepha/cache";

alepha.store.mut(cacheOptions, (c) => ({ ...c, enabled: false }));
```

## Events

Every cache emits `cache:hit`, `cache:missed` and `cache:set` (`{ container, key }`, plus `ttlMs` on `set`), and with `stale`, `cache:staleServed` when a stale value is served and `cache:revalidated` when its background refresh lands.

## Serialization

The cache automatically handles serialization:

- **JSON values**: Serialized with `JSON.stringify` / `JSON.parse`
- **Strings**: Stored as raw UTF-8
- **Uint8Array**: Stored as raw binary

The serialization format is detected automatically during deserialization based on a type byte prefix.
