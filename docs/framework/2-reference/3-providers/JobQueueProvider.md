# JobQueueProvider

## Import

```typescript
import { JobQueueProvider } from "alepha/api/jobs";
```

## Overview

Queue-backed `JobDispatcher` registered by `AlephaApiJobsQueue`.

Extends `JobDispatcher` and substitutes the default
`DirectJobDispatcher` so that `$job.push()` is delivered through
`AlephaQueue` (e.g. Cloudflare Queues, Redis, in-memory) instead of
being processed in-process.

This talks to `QueueProvider` / `WorkerProvider` directly. The queue is an
internal transport under `$job`, not something an application declares.

