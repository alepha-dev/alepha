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

For more details, see the [Descriptors documentation](https://feunard.github.io/alepha/docs/descriptors).

#### $cache()

Creates a cache descriptor for high-performance data caching with automatic cache management.

This descriptor provides a powerful caching layer that can significantly improve application performance
by storing frequently accessed data in memory or external cache stores like Redis. It supports both
function result caching and manual cache operations with intelligent serialization and TTL management.

**Key Features**

- **Function Result Caching**: Automatically cache function results based on input parameters
- **Multiple Storage Backends**: Support for in-memory, Redis, and custom cache providers
- **Intelligent Serialization**: Automatic handling of JSON, strings, and binary data
- **TTL Management**: Configurable time-to-live with automatic expiration
- **Cache Invalidation**: Pattern-based cache invalidation with wildcard support
- **Environment Controls**: Enable/disable caching via environment variables
- **Type Safety**: Full TypeScript support with generic type parameters

## Cache Strategies

### 1. Function Result Caching (Memoization)
Automatically cache the results of expensive operations based on input parameters.

### 2. Manual Cache Operations
Direct cache operations for custom caching logic and data storage.

## Storage Backends

- **Memory**: Fast in-memory cache (default for development)
- **Redis**: Distributed cache for production environments
- **Custom Providers**: Implement your own cache storage backend

**Basic function result caching:**
```ts
import { $cache } from "@alepha/cache";

class DataService {
  // Cache expensive database queries
  getUserData = $cache({
    name: "user-data",
    ttl: [10, "minutes"],
    handler: async (userId: string) => {
      // Expensive database operation
      return await database.users.findById(userId);
    }
  });

  async getUser(id: string) {
    // This will hit cache on subsequent calls with same ID
    return await this.getUserData(id);
  }
}
```

**API response caching with custom key generation:**
```ts
class ApiService {
  fetchUserPosts = $cache({
    name: "user-posts",
    ttl: [5, "minutes"],
    key: (userId: string, page: number) => `${userId}:page:${page}`,
    handler: async (userId: string, page: number = 1) => {
      const response = await fetch(`/api/users/${userId}/posts?page=${page}`);
      return await response.json();
    }
  });
}
```

**Manual cache operations for custom logic:**
```ts
class SessionService {
  sessionCache = $cache<UserSession>({
    name: "user-sessions",
    ttl: [1, "hour"],
    provider: "memory"  // Use memory cache for sessions
  });

  async storeSession(sessionId: string, session: UserSession) {
    await this.sessionCache.set(sessionId, session);
  }

  async getSession(sessionId: string): Promise<UserSession | undefined> {
    return await this.sessionCache.get(sessionId);
  }

  async invalidateUserSessions(userId: string) {
    // Invalidate all sessions for a user using wildcards
    await this.sessionCache.invalidate(`user:${userId}:*`);
  }
}
```

**Redis-backed caching for production:**
```ts
class ProductService {
  productCache = $cache({
    name: "products",
    ttl: [1, "hour"],
    provider: RedisCacheProvider,  // Use Redis for distributed caching
    handler: async (productId: string) => {
      return await this.database.products.findById(productId);
    }
  });

  async invalidateProduct(productId: string) {
    await this.productCache.invalidate(productId);
  }

  async invalidateAllProducts() {
    await this.productCache.invalidate("*");
  }
}
```

**Conditional caching with environment controls:**
```ts
class ExpensiveService {
  computation = $cache({
    name: "heavy-computation",
    ttl: [1, "day"],
    disabled: process.env.NODE_ENV === "development", // Disable in dev
    handler: async (input: ComplexInput) => {
      // Very expensive computation that should be cached in production
      return await performHeavyComputation(input);
    }
  });
}
```
