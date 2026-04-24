# JobQueueProvider

## Import

```typescript
import { JobQueueProvider } from "alepha/api/jobs";
```

## Overview

Plumbs outbox-style dispatch through `AlephaQueue`.

Registered only when the app imports `AlephaApiJobsQueue`. Sets
`JobProvider.queueDispatch` eagerly at instantiation so queue-mode jobs
can dispatch regardless of start-hook ordering.

