# Alepha - Cache

## Installation

Part of the `alepha` package. Import from `alepha/cache`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.9.0 | node, bun, workerd|

Type-safe caching with TTL support.

**Features:**
- Cached computations with type-safe keys and values
- Configurable TTL
- Cache invalidation
- Automatic cache population
- Providers: Memory (default), Redis

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $cache()

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

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### MemoryCacheProvider

In-memory implementation of CacheProvider for testing.

This provider stores all cache entries in memory, making it ideal for
unit tests that need to verify cache operations without touching Redis or other backends.

```typescript
// In tests, substitute the real CacheProvider with MemoryCacheProvider
const alepha = Alepha.create().with({
  provide: CacheProvider,
  use: MemoryCacheProvider,
});

// Run code that uses caching
const service = alepha.inject(MyService);
await service.fetchWithCache("key");

// Verify cache behavior
const cache = alepha.inject(MemoryCacheProvider);
expect(cache.stats().misses).toBe(1);
await service.fetchWithCache("key");
expect(cache.stats().hits).toBe(1);
```

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CACHE_DEFAULT_TTL` | number | 300 | The default time to live for cache entries. In seconds. |
| `CACHE_ENABLED` | boolean | true |  |
