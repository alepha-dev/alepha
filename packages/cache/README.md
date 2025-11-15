# Alepha Cache

A generic key-value caching interface with in-memory implementation.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
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

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $cache()

Creates a cache descriptor for high-performance data caching with automatic management.

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
