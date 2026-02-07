# Alepha - Server Links

## Installation

Part of the `alepha` package. Import from `alepha/server/links`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.6.0 | node, bun, workerd, expo |

Type-safe API client with request deduplication.

**Features:**
- Virtual HTTP client for type-safe API calls
- Remote action definitions
- Type inference from action schemas
- Request deduplication
- Automatic error handling

## API Reference

### Primitives

- [`$client`](/docs/reference-primitives-$client) — Create a new client.
- [`$remote`](/docs/reference-primitives-$remote) — $remote is a primitive that allows you to define remote service access.

### Providers

- [`LinkProvider`](/docs/reference-providers-linkprovider) — Browser, SSR friendly, service to handle links.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SERVER_API_PREFIX` | text | /api | Prefix for all API routes (e.g. $action). |
