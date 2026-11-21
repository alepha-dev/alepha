# JobDispatcher

## Import

```typescript
import { JobDispatcher } from "alepha/api/jobs";
```

## Overview

Abstract dispatcher for queued/direct job executions.

The default implementation, `DirectJobDispatcher`, runs the handler
in-process after the caller's `push()` returns - fast and dependency-free.

`AlephaApiJobsQueue` substitutes this with `JobQueueProvider`, which
publishes the executionId to `AlephaQueue` so a worker pool can consume
the work asynchronously.

`JobProvider` resolves one of those two classes by name, so a custom
dispatcher takes the place of the one in use, ahead of the module:

```ts
Alepha.create()
  .with({ provide: DirectJobDispatcher, use: MyCustomDispatcher })
  .with(AlephaApiJobs);
```

The `kind` getter is read by the `JobProvider.effectiveMode` accessor
and by the admin UI so users can see which dispatcher is currently active.
