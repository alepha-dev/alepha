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

**Cloudflare Workers** — when an `executionCtx.waitUntil` is available
in the alepha store at `cloudflare.waitUntil`, the dispatch wraps the
background promise with `waitUntil` so the runtime keeps the isolate
alive past the HTTP response. Without this, the handler would be
terminated when the response is returned and only the next sweep
(every 5 min by default) would re-dispatch.

**Vercel / single-Node** — on long-running runtimes the event loop
keeps the promise alive naturally; no special wiring is required.

