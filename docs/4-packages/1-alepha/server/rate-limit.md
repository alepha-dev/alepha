# Alepha - Server Rate Limit

## Installation

Part of the `alepha` package. Import from `alepha/server/rate-limit`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.16.0 | node, bun, workerd|

Request rate limiting on actions.

**Features:**
- Rate limit configuration per action

## API Reference

### Primitives

- [`$rateLimit`](/docs/reference-primitives-$ratelimit) — * Custom key function. Receives the handler arguments.
