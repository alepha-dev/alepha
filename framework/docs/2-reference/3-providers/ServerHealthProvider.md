# ServerHealthProvider

## Import

```typescript
import { ServerHealthProvider } from "alepha/server";
```

## Overview

Registers `GET /health` and `GET /healthz`, and the two probes an
orchestrator asks for separately: `GET /livez` and `GET /readyz`.

- `/health` and `/healthz` are readiness in practice: they answer 503 until
  the app is ready (`ServerNotReadyProvider`), 200 with `ready: true` after.
- `/livez` answers 200 as soon as the listener is bound, whatever the
  lifecycle: the process is alive. A liveness probe pointed at `/health`
  restarts a pod whose migrations are slow, in a loop.
- `/readyz` answers 503 until the app is ready, 200 after, and 503 again
  from the moment `stop()` begins (`Alepha.isStopping()`), so traffic moves
  away from an instance that is shutting down. Draining before the stop is
  the orchestrator's (a `preStop` wait): the framework adds no delay.

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
by the reverse proxy - see Bay's `internal/proxy` (`bay/` in this repository).
