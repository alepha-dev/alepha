# $rateLimit

## Import

```typescript
import { $rateLimit } from "alepha/server/rate-limit";
```

## Overview

Middleware that enforces rate limiting.

**Key resolution** (in order):

1. Explicit `key` function - user controls the key. Works anywhere (`$action`, `$job`, `$pipeline`).
2. Auto-detect `request.ip` from ALS - default for `$action` context.
3. `"global"` fallback - when no request context and no `key`. All calls share one bucket.

Sets `X-RateLimit-*` response headers when a request context is available.
Throws `HttpError(429)` when the limit is exceeded.

```typescript
// In $action: automatically rate limits by IP
$action({ use: [$rateLimit({ max: 100, windowMs: 60000 })] });

// In $action: rate limit by custom key
$action({
  use: [$rateLimit({ max: 10, windowMs: 60000, key: (req) => req.user?.id })],
});

// In $job: rate limit all executions globally
$job({ use: [$rateLimit({ max: 5, windowMs: 3600000 })] });
```

## Options

| Option | Type     | Required | Description         |
| ------ | -------- | -------- | ------------------- |
| `key`  | `Object` | No       | Custom key function |
