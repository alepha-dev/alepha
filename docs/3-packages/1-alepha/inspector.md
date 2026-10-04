# Alepha - Inspector

## Installation

Part of the `alepha` package. Import from `alepha/inspector`.

```bash
npm install alepha
```

## Overview

Runtime inspection of a running application, as a protocol other tools
build on.

**Features:**

- Application metadata: actions, jobs, topics, storages, realms, roles,
  caches, pages, providers, modules, entities, env, atoms
- A log buffer that survives a restart, read with a cursor
- Database rows, job executions, atom writes, the local email and SMS outbox
- One route table, independent of `$route`, for every transport
- A run registry: each process announces itself in
  `~/.alepha/run/<runId>.json`, and `InspectorRegistry.discover()` lists them
- Served over a per-process Unix socket (`<runId>.sock`, `0600`), never on
  the app's own port

No application imports it. `alepha dev` injects it into the app it serves,
and the devtools app (`npx @alepha/devtools`) is its first consumer.

SECURITY: the inspector reads and MUTATES application state and serves the
environment, secrets included. It registers in development only: never in
production and never under test, unless `ALEPHA_INSPECT=1` asks for it
explicitly. The providers are deliberately NOT listed under `services`,
which would register them whatever this guard decides.

## API Reference

### Providers

- [`DevAtomLogProvider`](/docs/reference-providers-devatomlogprovider) - In-memory ring buffer of `state:mutate` events, powering the devtools
- [`DevLogStoreProvider`](/docs/reference-providers-devlogstoreprovider) - The devtools log buffer, and the part of it that outlives the process.
- [`InspectorRoutes`](/docs/reference-providers-inspectorroutes) - The inspector protocol: every endpoint a tool can call on a running app.
- [`InspectorRunProvider`](/docs/reference-providers-inspectorrunprovider) - The run registry, write side: announces this process in
- [`InspectorSocketServer`](/docs/reference-providers-inspectorsocketserver) - Serves the inspector's route table as HTTP over a per-process Unix socket,
