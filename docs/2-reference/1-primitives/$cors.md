# $cors

## Import

```typescript
import { $cors } from "alepha/server/cors";
```

## Overview

Middleware that applies CORS headers to the response and handles OPTIONS preflight.

Reads the request from the ALS context and applies the configured
CORS headers via `ServerCorsProvider`. Options are merged with
global CORS defaults.

For OPTIONS preflight requests, the middleware short-circuits with a 204 response
and skips the handler entirely.

**Route middleware** - requires a request context (`$action`). Throws if used outside one.

```typescript
class ApiController {
  getOrders = $action({
    use: [$cors({ origin: "https://app.example.com", credentials: true })],
    handler: async ({ query }) => { ... },
  });
}
```
