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

- [`$rateLimit`](/docs/reference-primitives-$ratelimit) — Declares rate limiting for server routes or custom usage.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RATE_LIMIT_MAX_REQUESTS` | number | 100 | Maximum requests per window |
| `RATE_LIMIT_WINDOW_MS` | number | 15 * 60 * 1000 | Rate limit window in milliseconds |
