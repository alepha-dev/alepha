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
- Providers: Memory (default on Node), Cloudflare KV (default on workerd), Redis, Database

## API Reference

### Primitives

- [`$cache`](/docs/reference-primitives-$cache) - Creates a cache primitive for caching with automatic management.

### Providers

- [`CacheProvider`](/docs/reference-providers-cacheprovider) - Cache provider interface.
- [`CloudflareKVProvider`](/docs/reference-providers-cloudflarekvprovider) - Cloudflare KV cache provider.
- [`MemoryCacheProvider`](/docs/reference-providers-memorycacheprovider) - In-memory implementation of CacheProvider for testing.
