# $secure

## Import

```typescript
import { $secure } from "alepha/security";
```

## Overview

Middleware that enforces authentication and authorization.

Resolves the user from the request context, `currentUserAtom`, or authorization headers.
Throws `UnauthorizedError` if no user is resolved, `ForbiddenError` if checks fail.
Stores the resolved user in `currentUserAtom` and `request.user` for downstream access.

Works across all transports (atom-first resolution):
1. `currentUserAtom`: set by `action.run()` fork, MCP transport, pipelines, jobs
2. `request.user`: set by previous middleware
3. HTTP headers - JWT/API key resolution

## Check Order

When multiple options are provided, they are checked in this fixed order.
All provided options must pass (AND). Each option has its own logic:

1. **Authentication**: Is there a valid user? → `UnauthorizedError` (401)
2. **Issuers** (OR): Does the user's realm match at least one? → `ForbiddenError` (403)
3. **Roles** (OR): Does the user have at least one of the listed roles? → `ForbiddenError` (403)
4. **Permissions** (AND): Does the user's role grant all listed permissions? → `ForbiddenError` (403)
5. **Guard**: Does the custom function return `true`? → `ForbiddenError` (403)

Permissions declared in `$secure()` are auto-created in the permission registry at definition time.

Because `permissions` is an AND list, the resulting `ownership` is the most
restrictive of the matched grants - one owner-scoped permission narrows the
whole call, whatever order the list was written in.

The resolved user is published to `currentUserAtom` and to the request
**before** the guard runs, so anything the guard calls (a repository read in
`$owns`, for instance) resolves the same tenant the handler would.

## Browser Behavior

On the server, `$secure` throws `UnauthorizedError` or `ForbiddenError`.
In the browser, it returns `undefined` instead - the handler is never called.

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

  adminManage = $action({
    use: [$secure({
      issuers: ["main"],
      roles: ["admin"],
      permissions: ["admin:manage"],
      guard: ({ user }) => !!user.email,
    })],
    handler: () => { ... },
  });
}
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `issuers` | `string[]` | No | Restrict to specific issuers (realms) |
| `roles` | `string[]` | No | Required roles |
| `permissions` | `Object` | No | Required permissions |
| `guard` | `Object` | No | Custom guard |

