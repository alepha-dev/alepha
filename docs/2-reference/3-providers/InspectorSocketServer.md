# InspectorSocketServer

## Import

```typescript
import { InspectorSocketServer } from "alepha/inspector";
```

## Overview

Serves the inspector's route table as HTTP over a per-process Unix socket,
`<runDir>/<runId>.sock`, mode `0600`.

A socket rather than a TCP port: no port to pick or collide on, no CORS, and
nothing reachable from the network. The unauthenticated routes that read
the env and write the database no longer live on the app's public port;
only the socket's owner can connect.

Plain `node:http`, which Bun implements too. Every request goes through
`InspectorDispatcher`, so the socket validates input and serializes output
exactly as the specs exercise it.
