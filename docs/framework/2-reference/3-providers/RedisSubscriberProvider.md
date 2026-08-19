# RedisSubscriberProvider

## Import

```typescript
import { RedisSubscriberProvider } from "alepha/redis";
```

## Overview

Abstract Redis subscriber provider interface.

This abstract class defines the common interface for Redis pub/sub subscriptions.
Implementations include:
- `NodeRedisSubscriberProvider` - Uses `@redis/client` for Node.js runtime
- `BunRedisSubscriberProvider` - Uses Bun's native `RedisClient` for Bun runtime

Redis requires separate connections for pub/sub operations, so this provider
creates a dedicated connection for subscriptions.

