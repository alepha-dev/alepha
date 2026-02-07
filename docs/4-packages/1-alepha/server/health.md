# Alepha - Server Health

## Installation

Part of the `alepha` package. Import from `alepha/server/health`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.7.0 | node, bun, workerd|

Application health monitoring endpoints.

**Features:**
- `GET /health` endpoint

## API Reference

### Providers

- [`ServerHealthProvider`](/docs/reference-providers-serverhealthprovider) — Register `/health` & `/healthz` endpoint.
