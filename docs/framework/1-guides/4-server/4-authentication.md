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

| Setting                  | Default    |
| ------------------------ | ---------- |
| Access token expiration  | 15 minutes |
| Refresh token expiration | 30 days    |

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

- **admin**: Full access to all resources and permissions.
- **user**: Access to owned resources only.

### Settings That Send a Code Need `features.notifications`

`verifyEmailRequired`, `verifyPhoneRequired` and `resetPasswordAllowed` each
complete only by delivering a code. Turning one on without
`features: { notifications: true }` is refused at boot:

```typescript
class App {
  // Throws: sets resetPasswordAllowed but features.notifications is off.
  realm = $realm({
    settings: { resetPasswordAllowed: true },
  });
}
```

The feature flag is all it takes - it registers the notifications module
itself, so there is no separate import to remember:

```typescript check
import { $realm } from "alepha/api/users";

class App {
  realm = $realm({
    features: { notifications: true },
    settings: { resetPasswordAllowed: true },
  });
}
```

Settings you never mention are unaffected; all three default to `false`.

### Registration Does Not Confirm Who Has an Account

Registration is deliberately unhelpful about which identifiers are already
taken, because a helpful answer is an account-enumeration oracle: post an
address, read the error, learn whether that person has an account here.

The behavior depends on `verifyEmailRequired`:

- **Verification on**: an address already on file gets the _same_ response a
  fresh one gets: an intent id and "check your inbox". No verification code is
  minted, so the intent can never be completed. The real owner is emailed a
  `registrationAttempt` notice instead, which carries no code and asks for no
  action.
- **Verification off**: a taken username, email or phone all produce one
  identical error. It never names the field that collided.

Server logs still record which identifier it was, at `debug` level.

If you present registration errors in your own UI, do not try to map the
generic conflict back to a specific field - there is nothing to map it to,
and re-deriving it client-side would reopen the hole.

### Identity Providers

Enable login methods through the `identities` option:

```typescript
realm = $realm({
  identities: {
    credentials: true, // email/password (default)
    google: true, // Google OAuth
    github: true, // GitHub OAuth
  },
});
```

### An OAuth Sign-Up Is Only as Verified as the Provider Says

A first OAuth login creates the local account, and its `emailVerified` flag
follows the provider's `email_verified` claim. A provider that sends `false`
produces an unverified account and the ordinary verification is sent.

A provider that sends no claim has asserted nothing at all.
`trustProviderEmail` decides what to do with those, and defaults to `true`, so
the major providers (Google, Microsoft, Apple, GitHub all send the claim) are
unaffected either way. Turn it off for a realm that accepts logins from a
provider where anyone can claim an address they do not own:

```typescript check
import { $realm } from "alepha/api/users";

class App {
  realm = $realm({
    features: { notifications: true },
    // A provider that stays silent about the address is not believed.
    settings: { trustProviderEmail: false },
  });
}
```

A claim of `false` is honoured whatever this setting says. It only ever
decides the silent case.

## Self-Service Account Endpoints

`alepha/api/users` ships the endpoints an account area needs, all under
`/users/me`. Every one carries a bare `$secure()` (a session and no permission)
and resolves the row from `user.id`. None of them takes an id parameter,
which is what makes it safe to leave them un-permissioned: a caller can only
ever ask about themselves. Operators go through the `Admin*` controllers, which
have their own permissions.

Declared paths are shown; as `$action`s they serve under the `/api` prefix
(`GET /api/users/me`).

| Controller               | Endpoints                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `MyProfileController`    | `GET`/`PATCH /users/me`                                                                             |
| `MyAvatarController`     | `POST`/`DELETE /users/me/avatar`                                                                    |
| `MyIdentityController`   | `GET /users/me/identities`, `POST /users/me/identities/password`, `DELETE /users/me/identities/:id` |
| `MyPasswordController`   | `POST /users/me/password`                                                                           |
| `MySessionController`    | `GET /users/me/sessions`, `DELETE /users/me/sessions/:id`, `POST /users/me/sessions/revoke-others`  |
| `MyConnectionController` | `GET /users/me/connections`, `DELETE /users/me/connections/:id`                                     |
| `MyAccountController`    | `DELETE /users/me`                                                                                  |

Two rules are worth knowing before you wire a UI to them:

- **Setting a first password and changing one are different endpoints.**
  `setMyFirstPassword` trusts the session and refuses once a `credentials`
  identity exists; `changeMyPassword` verifies the current password and revokes
  every other session. Using the first to change a password would make an
  unattended signed-in browser a full account takeover.
- **Unlinking the last identity is refused.** An account with no sign-in method
  is not locked, it is unreachable - and password reset cannot recover it,
  because that needs a `credentials` identity to reset.

`@alepha/ui` provides the matching UI as `AccountRouter` - see the
[frontend routing guide](/docs/guides-frontend-routing).

### Deleting an Account: the `user:delete:before` Hook

`deleteMyAccount` is a hard delete, and it asks for two independent proofs: the
current password (that it is _you_) and the account's email typed verbatim
(that you _meant it_). An OAuth-only account has no password to prove, so the
confirmation stands alone.

The framework only knows about users, identities and sessions. It cannot know
what your application hangs off a user id, so it emits `user:delete:before`
first and **awaits** it. A handler that throws aborts the deletion, and the
error reaches the caller unwrapped - with its own status and message.

The hook lives in `UserService.deleteUser`, which every deletion goes through:
self-service, `AdminUserController`'s single delete, and its bulk delete. One
account, one set of consequences, whoever pressed the button.

```typescript
class UserDeletionHook {
  protected readonly projects = $repository(projects);

  onUserDelete = $hook({
    on: "user:delete:before",
    handler: async ({ userId }) => {
      const owned = await this.projects.count({ createdBy: { eq: userId } });
      if (owned > 0) {
        throw new ConflictError(`You still own ${owned} project(s).`);
      }
    },
  });
}
```

> **Write one if you have foreign keys to `users.id`.** Without it you are
> trusting your own cascade rules, and the failure mode is silent: a column
> with no foreign key leaves orphaned rows pointing at a user that no longer
> exists, and an `onDelete: "cascade"` column can delete rows the account
> authored _inside other people's data_. Neither is visible in a diff.

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

1. **`currentUserAtom`**: checked first. Set by `$action.run()` fork, MCP transports, pipelines, and jobs.
2. **`request.user`**: HTTP request user set by previous middleware.
3. **HTTP headers**: JWT or API key resolved from `Authorization` header.

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

The user is scoped to the action call using ALS fork isolation - it does not leak to subsequent calls.

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
      permissions: [{ name: "articles:list" }, { name: "articles:get" }],
    },
  ],
});
```

### Wildcard Permissions

Permissions use a colon-separated hierarchy. The `*` wildcard matches everything at and below its level:

| Pattern            | Matches                                            | Does not match     |
| ------------------ | -------------------------------------------------- | ------------------ |
| `*`                | Everything (admin access)                          | -                  |
| `articles:*`       | `articles:list`, `articles:get`, `articles:delete` | `media:upload`     |
| `admin:articles:*` | `admin:articles:list`, `admin:articles:update`     | `admin:users:list` |

Permissions declared in `$secure({ permissions: [...] })` are **auto-created** in the permission registry at definition time - no separate registration step is needed.

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

This grants access to all actions, but only for the user's own resources. The `exclude` array removes specific permission patterns - here, all admin-namespaced actions are excluded entirely.

## $secure Options

`$secure()` accepts four options. All are optional - when none are provided, it only checks authentication.

```typescript
$secure({
  issuers?: string[],
  roles?: string[],
  permissions?: (string | Permission)[],
  guard?: (ctx: SecureGuardContext) => Async<boolean>,
})
```

The `guard` receives a context object - `{ user, params, query, body, request?, alepha }` - and may be async:

```typescript
guard: ({ user, params }) => user.id === params.id;
```

### Check Order

When multiple options are provided, checks run in this fixed order. Each check must pass before the next runs:

1. **Authentication**: Is there a valid user? → `UnauthorizedError` (401) if not.
2. **Issuers**: Does the user's realm match one of the listed issuers? → `ForbiddenError` (403) if not.
3. **Roles**: Does the user have at least one of the listed roles? → `ForbiddenError` (403) if not.
4. **Permissions**: Does the user's role grant all listed permissions? → `ForbiddenError` (403) if not.
5. **Guard**: Does the custom function return `true`? → `ForbiddenError` (403) if not.

### AND vs OR Logic

- **Issuers**: OR: user must match **at least one** of the listed issuers.
- **Roles**: OR: user must have **at least one** of the listed roles.
- **Permissions**: AND: user must have **all** listed permissions.
- **Options**: AND: all provided options must pass.

### Examples

```typescript
// Auth only - any authenticated user
profile = $action({
  use: [$secure()],
  handler: ({ user }) => user,
});

// Role check (OR) - admin or manager
dashboard = $action({
  use: [$secure({ roles: ["admin", "manager"] })],
  handler: () => {
    /* ... */
  },
});

// Permission check (AND) - must have both
publish = $action({
  use: [$secure({ permissions: ["articles:create", "articles:publish"] })],
  handler: () => {
    /* ... */
  },
});

// Issuer restriction
adminPanel = $action({
  use: [$secure({ issuers: ["admin"] })],
  handler: () => {
    /* ... */
  },
});

// Custom guard - runs after all other checks
ownProfile = $action({
  use: [$secure({ guard: ({ user, params }) => user.id === params.id })],
  handler: () => {
    /* ... */
  },
});

// Combining options - all must pass
adminManage = $action({
  use: [
    $secure({
      issuers: ["main"],
      roles: ["admin"],
      permissions: ["admin:manage"],
      guard: ({ user }) => !!user.email,
    }),
  ],
  handler: () => {
    /* ... */
  },
});
```

### Browser Behavior

On the server, `$secure` throws errors (401/403). In the browser, it returns `undefined` instead - the handler is never called. On `$client` virtual actions, `can()` checks authorization without calling:

```typescript
// Browser: returns undefined if unauthorized, "ok" if authorized
const result = await action();

// $client actions expose can() to check without calling
if (client.myAction.can()) {
  // render the button
}
```

## HTTP Basic Auth

`$basicAuth` provides HTTP Basic Authentication for simple use cases (webhooks, internal tools):

```typescript
import { $env, z } from "alepha";
import { $basicAuth } from "alepha/security";

class WebhookController {
  protected readonly env = $env(z.object({ WEBHOOK_SECRET: z.text() }));

  webhook = $action({
    use: [
      $basicAuth({ username: "stripe", password: this.env.WEBHOOK_SECRET }),
    ],
    handler: ({ body }) => {
      /* ... */
    },
  });
}
```

Uses timing-safe comparison to prevent timing attacks. Returns 401 with `WWW-Authenticate` header on failure.

## Service Accounts

`$serviceAccount` manages tokens for service-to-service communication:

```typescript
import { $env, z } from "alepha";
import { $serviceAccount } from "alepha/security";

env = $env(z.object({ CLIENT_ID: z.text(), CLIENT_SECRET: z.text() }));

// OAuth2 client credentials
external = $serviceAccount({
  oauth2: {
    url: "https://provider.com/oauth2/token",
    clientId: this.env.CLIENT_ID,
    clientSecret: this.env.CLIENT_SECRET,
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
