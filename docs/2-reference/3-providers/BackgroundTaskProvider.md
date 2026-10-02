# BackgroundTaskProvider

## Import

```typescript
import { BackgroundTaskProvider } from "alepha/background";
```

## Overview

Runs fire-and-forget work that should outlive the request that scheduled it
(sending a welcome email, an audit write, a webhook) without blocking the
response.

On a long-lived runtime (Node, Vercel) the event loop keeps the promise
alive, so the only job here is to detach the task from the caller and never
leak an unhandled rejection. On serverless/edge runtimes that freeze the
isolate once the response is returned (Cloudflare Workers) the
`WorkerdBackgroundTaskProvider` variant additionally wraps the task in
`executionCtx.waitUntil` - call sites stay platform-agnostic and only ever
call `defer`.

In-flight tasks are tracked and awaited on shutdown (`flush`), so graceful
stop, `run({ once })`, and unit tests don't silently drop work.
