# $secure

## Import

```typescript
import { $secure } from "alepha/security";
```

## Overview

* Restrict to a specific authentication realm.
   */
  realm?: string;

  /**
   * Required permissions. All must be satisfied.
   */
  permissions?: (string | Permission)[];
}

/**
Middleware that enforces authentication and authorization.

Resolves the user from the request's authorization header via `SecurityProvider`.
Throws `UnauthorizedError` if no user is resolved, `ForbiddenError` if permissions fail.
Sets `request.user` and stores user in ALS for downstream access.

**Route middleware** — requires a request context (`$action`). Throws if used outside one.

```typescript
class OrderController {
  getOrders = $action({
    use: [$secure()],
    handler: async ({ query }) => { ... },
  });

  deleteOrder = $action({
    use: [$secure({ permissions: ["orders:delete"] })],
    handler: async ({ params }) => { ... },
  });
}
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `realm` | `string` | No | Restrict to a specific authentication realm. |
| `permissions` | `Object` | No | Required permissions |

