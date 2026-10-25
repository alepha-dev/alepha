# NodeRedisProvider

## Import

```typescript
import { NodeRedisProvider } from "alepha/redis";
```

## Overview

Node.js Redis client provider using `@redis/client`.

This provider uses the official Redis client for Node.js runtime. The client
library is loaded on connect, so a Node app that never sets `REDIS_URL`
never loads it.
