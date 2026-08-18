# BunRedisSubscriberProvider

## Import

```typescript
import { BunRedisSubscriberProvider } from "alepha/redis";
```

## Overview

Bun Redis subscriber provider for pub/sub operations.

This provider creates a dedicated Redis connection for subscriptions,
as Redis requires separate connections for pub/sub operations.

