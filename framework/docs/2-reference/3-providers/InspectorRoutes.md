# InspectorRoutes

## Import

```typescript
import { InspectorRoutes } from "alepha/inspector";
```

## Overview

The inspector protocol: every endpoint a tool can call on a running app.

A plain table of `{ method, path, schema, handler }`, not `$route`s. The
per-process socket serves it and the typed client is derived from it.
Keeping it free of `$route` is what lets one table feed both.

SECURITY: these endpoints read and MUTATE application state (job
triggers and retries, action calls as any user) and serve the environment, secrets
included, in cleartext. They are unauthenticated by design, which is why
the module that registers them refuses production unless explicitly opted
into, and why the transport is a `0600` socket rather than a TCP port.
