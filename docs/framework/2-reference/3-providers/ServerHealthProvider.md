# ServerHealthProvider

## Import

```typescript
import { ServerHealthProvider } from "alepha/server";
```

## Overview

Registers `GET /health` and `GET /healthz`.

Part of `AlephaServer` rather than opt-in, because the thing that consumes it
cannot ask for it. A supervisor starting an app has no way to know whether
that app chose to expose a readiness endpoint, so it is left with a TCP dial,
and a process binds its port before it has run its migrations. An app is
therefore declared ready while it is still setting up its database, and gets
traffic it cannot serve. Making this universal is what lets a supervisor
distinguish "listening" from "working".

`ready` is the only load-bearing field: it follows the container's lifecycle,
so it is false for exactly as long as the app is still starting.

Not a security concern to have on by default: it says nothing an unauthorized
caller can use, and both this and `/metrics` are masked from the public host
by the reverse proxy - see `apps/bay/internal/proxy`.

