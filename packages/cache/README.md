# Alepha Cache

A generic key-value caching interface with in-memory implementation.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/cache
```

## Module

Provides high-performance caching capabilities for Alepha applications with configurable TTL and multiple storage backends.

The cache module enables declarative caching through the `$cache` descriptor, allowing you to cache method results,
API responses, or computed values with automatic invalidation and type safety. It supports both in-memory and
persistent storage backends for different performance and durability requirements.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaCache } from "alepha/cache";

const alepha = Alepha.create()
	.with(AlephaCache);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

#### $cache()

Creates a cache storage or a cache function.
