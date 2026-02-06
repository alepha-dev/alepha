# $rateLimit

> Declares rate limiting for server routes or custom usage.

## Import

```typescript
import { $rateLimit } from "alepha/server/rate-limit";
```

## Overview

Declares rate limiting for server routes or custom usage.
This primitive provides methods to check rate limits and configure behavior
within the server request/response cycle.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | Name identifier for this rate limit (default: property key). |
| `paths` | `string[]` | No | Path patterns to match (supports wildcards like /api/*). |

## Examples

```ts
class ApiService {
  // Apply rate limiting to specific paths
  apiRateLimit = $rateLimit({
    paths: ["/api/*"],
    max: 100,
    windowMs: 15 * 60 * 1000, // 15 minutes
  });

  // Or use check() method for manual rate limiting
  customAction = $action({
    handler: async (req) => {
      const result = await this.apiRateLimit.check(req);
      if (!result.allowed) throw new Error("Rate limited");
      return "ok";
    },
  });
}
```

