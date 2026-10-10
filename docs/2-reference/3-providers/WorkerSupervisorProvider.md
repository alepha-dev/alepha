# WorkerSupervisorProvider

## Import

```typescript
import { WorkerSupervisorProvider } from "@alepha/desktop/shell";
```

## Overview

`SupervisorProvider` on a real supervisor Worker running
`DesktopSupervisorWorker`, spawned from `supervisorUrl`.

A crash message can arrive while the main thread is blocked in the window
loop: it is queued, and delivered once the loop returns, before the answer
to `stop`. So `stop` always learns about it.
