# Alepha - Server Etag

## Installation

Part of the `alepha` package. Import from `alepha/server/etag`.

```bash
npm install alepha
```

## Overview

ETag-based response caching.

**Features:**
- ETag generation and validation
- Conditional request handling (304 Not Modified)
- Optional response caching (store)
- Cache-Control header support

## API Reference

### Primitives

- [`$etag`](/docs/reference-primitives-$etag) — Middleware that enables ETag-based response caching per-route.
