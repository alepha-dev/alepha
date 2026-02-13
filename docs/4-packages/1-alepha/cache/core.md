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

- [`$cache`](/docs/reference-primitives-$cache) — Creates a cache primitive for caching with automatic management.

### Providers

- [`CloudflareKVProvider`](/docs/reference-providers-cloudflarekvprovider) — Cloudflare KV cache provider.
- [`MemoryCacheProvider`](/docs/reference-providers-memorycacheprovider) — In-memory implementation of CacheProvider for testing.
