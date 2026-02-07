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
    secure: false,
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

When `AlephaSecurity` is registered, all actions are not secure by default.

To make an action secured, set `secure: true`:

```typescript
publicEndpoint = $action({
  secure: true,
  handler: () => "anyone can access this",
});
```

The authenticated user is available on the request object:

```typescript
profile = $action({
  path: "/me",
  secure: true,
  handler: async ({ user }) => {
    return user;
  },
});
```

## Roles and Permissions

Each action generates one permission automatically, named `{group}:{actionName}`.

Define roles with explicit permission sets:

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
