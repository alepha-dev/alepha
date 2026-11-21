# $cors

## Import

```typescript
import { $cors } from "alepha/server/cors";
```

## Overview

Middleware that applies CORS headers to the response of the route that declares it.

Options are merged with the global CORS defaults, and the result replaces
the global policy for that route, on the request and on its preflight.

The headers go on the response of the action that declares the middleware.
When that action is called in process, through `run()` from another route,
they stay off the calling route's response: its own policy governs it.

The preflight of a routed action is answered by an OPTIONS route generated
for its path. The middleware itself answers 204 and skips the handler only
when the request it runs on is an OPTIONS request, which is the case of a
route declared with `method: "OPTIONS"`.

**Route middleware** - requires a request context (`$action`). Throws if used outside one.

```typescript
class ApiController {
  getOrders = $action({
    method: "GET",
    path: "/getOrders",
    use: [$cors({ origin: "https://app.example.com", credentials: true })],
    handler: async ({ query }) => { ... },
  });
}
```
