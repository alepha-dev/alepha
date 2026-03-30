# WorkerdWorkerProvider

## Import

```typescript
import { WorkerdWorkerProvider } from "alepha/queue";
```

## Overview

Cloudflare Workers queue consumer provider.

Replaces the polling-based `WorkerProvider` in Cloudflare Workers.
Instead of running a polling loop, this provider hooks into `cloudflare:queue`
events emitted by the CF Workers `queue` handler.

