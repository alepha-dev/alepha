# $secure

## Import

```typescript
import { $secure } from "alepha/security";
```

## Overview

* Restrict to specific issuers (realms).
   * User must belong to one of the listed issuers.
   */
  issuers?: string[];

  /**
   * Required roles. User must have at least one of the listed roles.
   */
  roles?: string[];

  /**
   * Required permissions. All must be satisfied.
   */
  permissions?: (string | Permission)[];

  /**
   * Custom guard function. Runs after all other checks.
   * Return `false` to deny access.
   */
  guard?: (user: UserAccountToken) => boolean;
}

/**
Middleware that enforces authentication and authorization.

Resolves the user from the request context, `currentUserAtom`, or authorization headers.
Throws `UnauthorizedError` if no user is resolved, `ForbiddenError` if checks fail.
Stores the resolved user in `currentUserAtom` and `request.user` for downstream access.

Works across all transports (atom-first resolution):
1. `currentUserAtom` — set by `action.run()` fork, MCP transport, pipelines, jobs
2. `request.user` — set by previous middleware
3. HTTP headers — JWT/API key resolution

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
| `issuers` | `string[]` | No | Restrict to specific issuers (realms) |
| `roles` | `string[]` | No | Required roles |
| `permissions` | `Object` | No | Required permissions |
| `guard` | `Object` | No | Custom guard function |

