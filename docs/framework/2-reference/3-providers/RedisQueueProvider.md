# RedisQueueProvider

## Import

```typescript
import { RedisQueueProvider } from "alepha/queue/redis";
```

## Overview

Redis-backed queue: a LIST for what is deliverable now, and a **sorted set
scored by due-time** for what is not yet.

The delay tier exists because ignoring a delay is not a graceful
degradation: for a push transport it means delivering NOW, which for a
retry is zero backoff against a downstream that has just failed. Before
this, `push` declined a delayed send outright and the caller fell back to
a local timer (see `QueuePushOptions.delaySeconds`). That fallback
is still the right answer for any backend without a delay tier, and it is
still what happens if this one is unreachable, because the caller's outbox
row and its sweep remain the truth either way.
