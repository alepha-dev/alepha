# $debounce

## Import

```typescript
import { $debounce } from "alepha/datetime";
```

## Overview

Middleware that coalesces concurrent calls with the same key into a single handler execution.

All callers within the delay window receive the same result. No storage -
once the handler finishes, the next call starts fresh. Process-local.

**Use case**: thundering herd protection - cache expires, 100 requests
hit the same endpoint, debounce ensures one rebuild.

```typescript
class SearchController {
  search = $action({
    use: [$debounce({ delay: [200, "ms"], key: (req) => req.query.q })],
    handler: async ({ query }) => this.searchService.search(query.q),
  });
}
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `delay` | `DurationLike` | Yes | Coalescing window |
| `key` | `Object` | No | Key function to group calls |

