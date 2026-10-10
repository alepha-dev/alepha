# RedisActorProvider

## Import

```typescript
import { RedisActorProvider } from "alepha/actor/redis";
```

## Overview

One-key exact-byte CAS of validated actor envelopes using Redis eval.
Only a definite CAS conflict retries a pure reducer. Transport errors have
an unknown outcome and propagate without retry. No cache, expiry or eviction.
