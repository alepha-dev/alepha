# Alepha - Container

## Installation

Part of the `alepha` package. Import from `alepha/container`.

```bash
npm install alepha
```

## Overview

Type-safe RPC clients for ephemeral containerized Alepha apps.

**Features:**
- `$container<T>()` directive returns a typed Proxy onto a remote
  Alepha controller's `$action` endpoints — the wire format is the
  same `POST /api/<method>` shape served by every Alepha server.
- Pluggable transport: Node (plain `fetch` against a configured URL),
  Mock (in-process call via `LinkProvider.follow` for tests),
  Cloudflare workerd (`getContainer().fetch()` through the Containers
  binding — see `alepha/container` workerd entry).
- Build-time integration: `BuildCloudflareTask.enhanceContainers`
  emits the matching wrangler bindings and Durable Object class
  declarations.

The Node binding is the "temporary, not perfect" path documented in
the spec — apps need to provide an explicit `url` per primitive
until a `target=docker` adapter ships.

## API Reference

### Primitives

- [`$container`](/docs/reference-primitives-$container) — `$container` — typed RPC client to a containerized Alepha app.

### Providers

- [`CloudflareContainerProvider`](/docs/reference-providers-cloudflarecontainerprovider) — Cloudflare Workers (workerd) container provider.
- [`MockContainerProvider`](/docs/reference-providers-mockcontainerprovider) — In-process test provider.
- [`NodeContainerProvider`](/docs/reference-providers-nodecontainerprovider) — Node (dev / test / non-Cloudflare) container provider.
