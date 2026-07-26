# Authentication

Alepha provides JWT-based authentication through `$issuer` for token management and `$realm` for full user management.

## Token Management with $issuer

`$issuer` is the low-level primitive for creating and verifying JWT tokens. Use it when you manage users yourself or integrate with an external identity provider.

```typescript
import { $issuer } from "alepha/security";
import { $action } from "alepha/server";
import { z } from "alepha";

class AuthController {
  issuer = $issuer({
    secret: "your-secret-key",
  });

  login = $action({
    method: "POST",
    path: "/auth/login",
    schema: {
      body: z.object({
        email: z.email(),
        password: z.text(),
      }),
    },
    handler: async ({ body }) => {
      const user = await this.authenticate(body.email, body.password);
      return this.issuer.createToken(user);
    },
  });
}
```

### Internal vs External Issuers

An **internal** issuer signs and verifies tokens with a shared secret:

```typescript
issuer = $issuer({
  secret: "my-secret",
});
```

An **external** issuer verifies tokens from an external provider (Auth0, Keycloak, etc.) using JWKS:

```typescript
issuer = $issuer({
  jwks: () => process.env.AUTH0_JWKS_URL,
  profile: (payload) => ({
    id: payload.sub,
    email: payload.email,
    name: payload.name,
  }),
});
```

### Token Lifecycle

`$issuer` manages access tokens and refresh tokens:

| Setting | Default |
|---------|---------|
| Access token expiration | 15 minutes |
| Refresh token expiration | 30 days |

Override via the `settings` option:

```typescript
issuer = $issuer({
  secret: "...",
  settings: {
    accessToken: { expiration: [1, "hours"] },
    refreshToken: { expiration: [90, "days"] },
  },
});
```

## User Management with $realm

`$realm` is a higher-level primitive that wraps `$issuer` with built-in user management: registration, login, sessions, password handling, and identity providers.

```typescript check
import { $realm } from "alepha/api/users";

class App {
  realm = $realm();
}
```

`$realm` ships with two default roles:

- **admin** -- Full access to all resources and permissions.
- **user** -- Access to owned resources only.

### Registration Does Not Confirm Who Has an Account

Registration is deliberately unhelpful about which identifiers are already
taken, because a helpful answer is an account-enumeration oracle: post an
address, read the error, learn whether that person has an account here.

The behavior depends on `verifyEmailRequired`:

- **Verification on** — an address already on file gets the *same* response a
  fresh one gets: an intent id and "check your inbox". No verification code is
  minted, so the intent can never be completed. The real owner is emailed a
  `registrationAttempt` notice instead, which carries no code and asks for no
  action.
- **Verification off** — a taken username, email or phone all produce one
  identical error. It never names the field that collided.

Server logs still record which identifier it was, at `debug` level.

If you present registration errors in your own UI, do not try to map the
generic conflict back to a specific field — there is nothing to map it to,
and re-deriving it client-side would reopen the hole.

### Identity Providers

Enable login methods through the `identities` option:

```typescript
realm = $realm({
  identities: {
    credentials: true,  // email/password (default)
    google: true,       // Google OAuth
    github: true,       // GitHub OAuth
  },
});
```

## Securing Actions

Actions are public by default. To require authentication, add the `$secure()` middleware:

```typescript
import { $secure } from "alepha/security";

publicEndpoint = $action({
  handler: () => "anyone can access this",
});

protectedEndpoint = $action({
  use: [$secure()],
  handler: () => "only authenticated users",
});
```

The authenticated user is available on the request object:

```typescript
profile = $action({
  path: "/me",
  use: [$secure()],
  handler: async ({ user }) => {
    return user;
  },
});
```

You can also restrict access to a specific issuer or role:

```typescript
adminOnly = $action({
  use: [$secure({ issuers: ["admin"] })],
  handler: () => "admin issuer only",
});

managersOnly = $action({
  use: [$secure({ roles: ["manager", "admin"] })],
  handler: () => "managers and admins only",
});
```

### User Resolution

`$secure()` resolves the authenticated user using atom-first resolution, which works across all transports:

1. **`currentUserAtom`** — checked first. Set by `$action.run()` fork, MCP transports, pipelines, and jobs.
2. **`request.user`** — HTTP request user set by previous middleware.
3. **HTTP headers** — JWT or API key resolved from `Authorization` header.

### Local Action Calls

When calling an action locally via `.run()`, pass the user in options:

```typescript
// Pass a specific user
await controller.action.run({}, { user: { id: "user-1", roles: ["admin"] } });

// Use the system user
await controller.action.run({}, { user: "system" });

// Use the user from the current HTTP request
await controller.action.run({}, { user: "context" });
```

The user is scoped to the action call using ALS fork isolation — it does not leak to subsequent calls.

In test mode, `.fetch()` automatically creates a JWT token from the user option:

```typescript
// Automatic test token creation
const res = await controller.action.fetch({}, { user: { id: "test-user" } });
```

## Roles and Permissions

Define roles with permission sets in the issuer:

```typescript
issuer = $issuer({
  secret: "...",
  roles: [
    {
      name: "admin",
      permissions: [{ name: "*" }],
    },
    {
      name: "editor",
      permissions: [
        { name: "articles:*" },
        { name: "media:upload" },
        { name: "admin:articles:*" },
      ],
    },
    {
      name: "viewer",
      permissions: [
        { name: "articles:list" },
        { name: "articles:get" },
      ],
    },
  ],
});
```

### Wildcard Permissions

Permissions use a colon-separated hierarchy. The `*` wildcard matches everything at and below its level:

| Pattern | Matches | Does not match |
|---------|---------|----------------|
| `*` | Everything (admin access) | — |
| `articles:*` | `articles:list`, `articles:get`, `articles:delete` | `media:upload` |
| `admin:articles:*` | `admin:articles:list`, `admin:articles:update` | `admin:users:list` |

Permissions declared in `$secure({ permissions: [...] })` are **auto-created** in the permission registry at definition time — no separate registration step is needed.

### Ownership

The `ownership` flag restricts a permission to resources owned by the user:

```typescript
{
  name: "user",
  permissions: [
    {
      name: "*",
      ownership: true,
      exclude: ["admin:*"],
    },
  ],
}
```

This grants access to all actions, but only for the user's own resources. The `exclude` array removes specific permission patterns — here, all admin-namespaced actions are excluded entirely.

## $secure Options

`$secure()` accepts four options. All are optional — when none are provided, it only checks authentication.

```typescript
$secure({
  issuers?: string[],
  roles?: string[],
  permissions?: (string | Permission)[],
  guard?: (user: UserAccountToken) => boolean,
})
```

### Check Order

When multiple options are provided, checks run in this fixed order. Each check must pass before the next runs:

1. **Authentication** — Is there a valid user? → `UnauthorizedError` (401) if not.
2. **Issuers** — Does the user's realm match one of the listed issuers? → `ForbiddenError` (403) if not.
3. **Roles** — Does the user have at least one of the listed roles? → `ForbiddenError` (403) if not.
4. **Permissions** — Does the user's role grant all listed permissions? → `ForbiddenError` (403) if not.
5. **Guard** — Does the custom function return `true`? → `ForbiddenError` (403) if not.

### AND vs OR Logic

- **Issuers** — OR: user must match **at least one** of the listed issuers.
- **Roles** — OR: user must have **at least one** of the listed roles.
- **Permissions** — AND: user must have **all** listed permissions.
- **Options** — AND: all provided options must pass.

### Examples

```typescript
// Auth only — any authenticated user
profile = $action({
  use: [$secure()],
  handler: ({ user }) => user,
});

// Role check (OR) — admin or manager
dashboard = $action({
  use: [$secure({ roles: ["admin", "manager"] })],
  handler: () => { /* ... */ },
});

// Permission check (AND) — must have both
publish = $action({
  use: [$secure({ permissions: ["articles:create", "articles:publish"] })],
  handler: () => { /* ... */ },
});

// Issuer restriction
adminPanel = $action({
  use: [$secure({ issuers: ["admin"] })],
  handler: () => { /* ... */ },
});

// Custom guard — runs after all other checks
ownProfile = $action({
  use: [$secure({ guard: (user) => user.id === params.id })],
  handler: () => { /* ... */ },
});

// Combining options — all must pass
adminManage = $action({
  use: [$secure({
    issuers: ["main"],
    roles: ["admin"],
    permissions: ["admin:manage"],
    guard: (user) => !!user.email,
  })],
  handler: () => { /* ... */ },
});
```

### Browser Behavior

On the server, `$secure` throws errors (401/403). In the browser, it returns `undefined` instead — the handler is never called. Use `action.can()` to conditionally render UI:

```typescript
// Browser: returns undefined if unauthorized, "ok" if authorized
const result = await action();

// Use action.can() to check without calling
if (action.can()) {
  // render the button
}
```

## HTTP Basic Auth

`$basicAuth` provides HTTP Basic Authentication for simple use cases (webhooks, internal tools):

```typescript
import { $basicAuth } from "alepha/security";

webhook = $action({
  use: [$basicAuth({ username: "stripe", password: process.env.WEBHOOK_SECRET })],
  handler: ({ body }) => { /* ... */ },
});
```

Uses timing-safe comparison to prevent timing attacks. Returns 401 with `WWW-Authenticate` header on failure.

## Service Accounts

`$serviceAccount` manages tokens for service-to-service communication:

```typescript
import { $serviceAccount } from "alepha/security";

// OAuth2 client credentials
external = $serviceAccount({
  oauth2: {
    url: "https://provider.com/oauth2/token",
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
  },
});

// JWT-based (internal issuer)
internal = $serviceAccount({
  issuer: myIssuer,
  user: { id: "batch-worker" },
});

// Usage: tokens are cached and auto-refreshed
const token = await external.token();
```
