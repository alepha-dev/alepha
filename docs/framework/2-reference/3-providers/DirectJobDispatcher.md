# DirectJobDispatcher

## Import

```typescript
import { DirectJobDispatcher } from "alepha/api/jobs";
```

## Overview

Default `JobDispatcher` for environments without `AlephaApiJobsQueue`.

Runs `JobProvider.processExecution` in the background — the caller's
`push()` returns immediately while the handler continues to completion
in the same process. The DB outbox row is the durability guarantee:
if the process dies before the handler finishes, the next sweep tick
picks the row up and re-dispatches.

Keeping the isolate alive past the HTTP response (Cloudflare Workers) vs.
relying on the event loop (Node/Vercel) is delegated to
`BackgroundTaskProvider.defer` — this dispatcher stays
platform-agnostic. The DB outbox row remains the durability guarantee: if
the process dies mid-handler, the next sweep re-dispatches.

