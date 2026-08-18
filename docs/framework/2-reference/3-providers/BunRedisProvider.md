# BunRedisProvider

## Import

```typescript
import { BunRedisProvider } from "alepha/redis";
```

## Overview

Bun Redis client provider using Bun's native Redis client.

This provider uses Bun's built-in `RedisClient` class for Redis connections,
which provides excellent performance (7.9x faster than ioredis) on the Bun runtime.

