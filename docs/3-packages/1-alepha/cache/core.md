# Alepha - Cache

## Installation

Part of the `alepha` package. Import from `alepha/cache`.

```bash
npm install alepha
```

## Overview

Type-safe caching with TTL support.

**Features:**

- Cached computations with type-safe keys and values
- Configurable TTL
- Cache invalidation
- Automatic cache population
- Providers: Redis when `REDIS_URL` is set, Memory otherwise (Node, Bun),
  Cloudflare (workerd), Database (per `$cache`)

Set `REDIS_URL` and every instance shares one cache; leave it unset and the
cache is this process's memory. An app's own `CacheProvider` substitution
wins over both.

## API Reference

### Primitives

- [`$cache`](/docs/reference-primitives-$cache) - Creates a cache primitive for caching with automatic management.

### Providers

- [`CacheProvider`](/docs/reference-providers-cacheprovider) - Cache provider interface.
- [`CloudflareCacheProvider`](/docs/reference-providers-cloudflarecacheprovider) - Cloudflare cache provider: the database cache when the app has one, else KV.
- [`CloudflareKVProvider`](/docs/reference-providers-cloudflarekvprovider) - Cloudflare KV cache provider.
- [`MemoryCacheProvider`](/docs/reference-providers-memorycacheprovider) - In-memory implementation of CacheProvider for testing.
- [`RedisCacheProvider`](/docs/reference-providers-rediscacheprovider) - Cache entries in Redis.
