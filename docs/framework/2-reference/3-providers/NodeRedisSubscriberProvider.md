# NodeRedisSubscriberProvider

## Import

```typescript
import { NodeRedisSubscriberProvider } from "alepha/redis";
```

## Overview

Node.js Redis subscriber provider using `@redis/client`.

This provider creates a dedicated Redis connection for subscriptions,
as Redis requires separate connections for pub/sub operations.

