# JobQueueProvider

## Import

```typescript
import { JobQueueProvider } from "alepha/api/jobs";
```

## Overview

Queue-backed `JobDispatcher` registered by `AlephaApiJobsQueue`.

Extends {@link JobDispatcher} and substitutes the default
`DirectJobDispatcher` so that `$job.push()` is delivered through
`AlephaQueue` (e.g. Cloudflare Queues, Redis, in-memory) instead of
being processed in-process.

The class is also kept as a `JobQueueProvider` export name for backwards
compatibility — it has always been the queue path's entry point.

