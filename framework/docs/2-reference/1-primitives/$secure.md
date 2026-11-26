# $secure

## Import

```typescript
import { $secure } from "alepha/security";
```

## Overview

Middleware that enforces authentication and authorization.

Resolves the user from the request context, `currentUserAtom`, or authorization headers.
Throws `UnauthorizedError` if no user is resolved, `ForbiddenError` if checks fail.
Publishes the resolved user in `currentUserAtom` and on `request.user`, for the guard and the handler it wraps.

Works across all transports (atom-first resolution):

1. `currentUserAtom`: set by the global `server:request:before` hook
   (`ServerSecurityProvider`), an `action.run()` fork, pipelines and jobs
2. `request.user`: set by previous middleware
3. HTTP headers - JWT/API key resolution

## Check Order

When multiple options are provided, they are checked in this fixed order.
All provided options must pass (AND). Each option has its own logic:

1. **Authentication**: Is there a valid user? → `UnauthorizedError` (401)
   With `sessionOnly`, is it a signed-in session rather than a machine credential? → `ForbiddenError` (403)
2. **Issuers** (OR): Does the user's realm match at least one? → `ForbiddenError` (403)
3. **Roles** (OR): Does the user have at least one of the listed roles? → `ForbiddenError` (403)
4. **Permissions** (AND): Does the user's role grant all listed permissions, and does the credential's `permissionScope` admit them? → `ForbiddenError` (403)
5. **Guard**: Does the custom function return `true`? → `ForbiddenError` (403)

Permissions declared in `$secure()` are auto-created in the permission registry at definition time.

Because `permissions` is an AND list, the resulting `ownership` is the most
restrictive of the matched grants - one owner-scoped permission narrows the
whole call, whatever order the list was written in.

That `ownership` is the answer to the permissions THIS `$secure` declares.
A `$secure` declaring none makes no decision: it keeps a restriction it
finds (`true`, a scope), and drops an unrestricted answer (`false`) another
gate published, back to what the identity itself carries, `undefined` for
a user resolved from a request. An unrestricted answer also stays on the
user object the gate hands its handler: a copy of that object (a spread, a
JSON round trip) does not carry it.

The user is published for as long as the gate runs, guard and handler:
once it returns, `currentUserAtom` reads the user it held before, and so
does `request.user` on a request the gate was merely running inside (a
pipeline called by an action's handler, a tool). What stays is
`request.user` on the request the gate itself guards, and on a request
that carried no user before the gate resolved one (a WebSocket upgrade
reads it there). A write the
handler makes to `currentUserAtom` takes effect for the rest of the gate
and goes with it.

⚠️ Gates running in parallel in ONE context (two pipelines under a
`Promise.all`) share that atom and that request: while both run each can
read the other's user there, and the last to return restores what it
found. The `user` a handler receives as an argument is never shared.

The resolved user is published to `currentUserAtom` and to the request
**before** the guard runs, so anything the guard calls (a repository read in
`$owns`, for instance) sees the same identity the handler would.

## Browser Behavior

On the server, `$secure` throws `UnauthorizedError` or `ForbiddenError`.
In the browser, it returns `undefined` instead - the handler is never called.

```typescript
class OrderController {
  getOrders = $action({
    method: "GET",
    path: "/getOrders",
    use: [$secure()],
    handler: async ({ query }) => { ... },
  });

  deleteOrder = $action({
    method: "POST",
    path: "/deleteOrder",
    use: [$secure({ permissions: ["orders:delete"] })],
    handler: async ({ params }) => { ... },
  });

  adminManage = $action({
    method: "POST",
    path: "/adminManage",
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

| Option        | Type                                                        | Required | Description                                                                                                         |
| ------------- | ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `issuers`     | `string[]`                                                  | No       | Restrict to specific issuers (realms)                                                                               |
| `roles`       | `string[]`                                                  | No       | Required roles                                                                                                      |
| `permissions` | `Object`                                                    | No       | Required permissions                                                                                                |
| `sessionOnly` | `boolean`                                                   | No       | Require a signed-in session: refuse an identity authenticated by a machine credential, whatever it may otherwise do |
| `privileged`  | `SecurePrivileged \| (() => SecurePrivileged \| undefined)` | No       | Which callers this gate publishes as unrestricted (`ownership: false`) when its permissions pass                    |
| `guard`       | `Object`                                                    | No       | Custom guard                                                                                                        |
