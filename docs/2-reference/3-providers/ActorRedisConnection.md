# ActorRedisConnection

## Import

```typescript
import { ActorRedisConnection } from "alepha/actor/redis";
```

## Overview

Injection token for an existing runtime Redis provider's get/eval seam.
Keeps the Node client out of Bun's conditional entry and vice versa.
