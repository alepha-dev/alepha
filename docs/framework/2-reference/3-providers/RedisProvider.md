# RedisProvider

## Import

```typescript
import { RedisProvider } from "alepha/redis";
```

## Overview

Abstract Redis provider interface.

This abstract class defines the common interface for Redis operations.
Implementations include:
- `NodeRedisProvider` - Uses `@redis/client` for Node.js runtime
- `BunRedisProvider` - Uses Bun's native `RedisClient` for Bun runtime

