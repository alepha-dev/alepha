# Alepha - Server Links

## Installation

Part of the `alepha` package. Import from `alepha/server/links`.

```bash
npm install alepha
```

## Overview

Type-safe API client with request deduplication.

**Features:**

- Virtual HTTP client for type-safe API calls
- Remote action definitions
- Type inference from action schemas
- Request deduplication
- Automatic error handling

Serving and calling, composed: the consumer half is
`AlephaServerLinksClient`, and what this adds on top is the part that
needs an HTTP server - the `/api/_links`, `/api/_links/schemas` and
`/api/_batch` routes, plus `$remote`'s service-to-service wiring.

The split is stated here rather than detected at runtime. `register()` can
only see what was registered before it, so an `alepha.has(AlephaServer)`
test would silently drop the routes for any app that registers this module
first - and for a client-rendered app, `/api/_batch` missing is the whole
API surface missing.

## API Reference

### Primitives

- [`$client`](/docs/reference-primitives-$client) - Create a new client.
- [`$remote`](/docs/reference-primitives-$remote) - $remote is a primitive that allows you to define remote service access.

### Providers

- [`LinkProvider`](/docs/reference-providers-linkprovider) - Browser, SSR friendly, service to handle links.
