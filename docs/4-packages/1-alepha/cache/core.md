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

- [`$cache`](/docs/primitives-$cache) — Creates a cache primitive for high-performance data caching with automatic management.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### MemoryCacheProvider

In-memory implementation of CacheProvider for testing.

This provider stores all cache entries in memory, making it ideal for
unit tests that need to verify cache operations without touching Redis or other backends.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CACHE_DEFAULT_TTL` | number | 300 | The default time to live for cache entries. In seconds. |
| `CACHE_ENABLED` | boolean | true |  |
