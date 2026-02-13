# Authentication

Alepha provides JWT-based authentication through `$issuer` for token management and `$realm` for full user management.

## Token Management with $issuer

`$issuer` is the low-level primitive for creating and verifying JWT tokens. Use it when you manage users yourself or integrate with an external identity provider.

```typescript
import { $issuer } from "alepha/security";
import { $action } from "alepha/server";
import { t } from "alepha";

class AuthController {
  issuer = $issuer({
    secret: "your-secret-key",
  });

  login = $action({
    method: "POST",
    path: "/auth/login",
    schema: {
      body: t.object({
        email: t.email(),
        password: t.text(),
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

```typescript
import { $realm } from "alepha/api/users";

class App {
  realm = $realm();
}
```

`$realm` ships with two default roles:

- **admin** -- Full access to all resources and permissions.
- **user** -- Access to owned resources only.

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

`$secure()` supports authentication-only, role checks, permission checks, and custom guards:

```typescript
// Auth only — any authenticated user
profile = $action({
  use: [$secure()],
  handler: ({ user }) => user,
});

// Auth + role check
dashboard = $action({
  use: [$secure({ roles: ["admin"] })],
  handler: () => { /* ... */ },
});

// Auth + explicit permissions
deleteOrder = $action({
  use: [$secure({ permissions: ["orders:delete"] })],
  handler: ({ params }) => { /* ... */ },
});

// Auth + permissions + issuer restriction
adminManage = $action({
  use: [$secure({ permissions: ["admin:manage"], issuers: ["admin"] })],
  handler: () => { /* ... */ },
});

// Auth + custom guard
ownProfile = $action({
  use: [$secure({ guard: (user) => user.id === params.id })],
  handler: () => { /* ... */ },
});
```

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

This grants access to all actions, but only for the user's own resources. Admin-namespaced actions are excluded entirely.
