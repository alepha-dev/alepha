# InspectorRoutes

## Import

```typescript
import { InspectorRoutes } from "alepha/inspector";
```

## Overview

The inspector protocol: every endpoint a tool can call on a running app.

A plain table of `{ method, path, schema, handler }`, not `$route`s. The
per-process socket serves it, the typed client is derived from it, and
until the in-app devtools goes, an adapter also mounts it on the app server
under `/__devtools/api`. Keeping it free of `$route` is what lets one table
feed all three.

SECURITY: these endpoints read and MUTATE application state (arbitrary DB
writes, atom writes, job triggers) and serve the environment, secrets
included, in cleartext. They are unauthenticated by design, which is why
the module that registers them refuses production unless explicitly opted
into, and why the transport is a `0600` socket rather than a TCP port.
