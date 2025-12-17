# Authentication & Security

In most frameworks, adding authentication involves:
1.  Installing Passport.js / NextAuth.
2.  Configuring a session store (Redis).
3.  Writing middleware to check headers.
4.  Manually hashing passwords.
5.  Praying you didn't leave a hole.

In Alepha, authentication is built on two low-level primitives: `$realm` and `$auth`. You can use them directly for full control, or use the higher-level presets for common scenarios.

## The Low-Level Primitives

### `$realm`: Token Management

A **Realm** is a security boundary. It handles JWT token creation, verification, and role management. It doesn't care *how* users authenticate—it just issues and validates tokens.

```typescript
import { $realm } from "alepha/security";
import { $env, t } from "alepha";

class AppSecurity {
  env = $env(t.object({
    REALM_SECRET: t.string({ default: "***********" }),
  }))

  // Internal realm: you control the secret
  internal = $realm({
    name: "app",
    secret: this.env.REALM_SECRET,
    roles: [{
      name: "user",
      permissions: [{ name: "*" }],
    }],
    settings: {
      accessToken: { expiration: [15, "minutes"] },
      refreshToken: { expiration: [30, "days"] },
    }
  });

  // External realm: validate tokens from Keycloak, Auth0, etc.
  external = $realm({
    name: "keycloak",
    jwks: () => "https://auth.example.com/realms/myrealm/protocol/openid-connect/certs",
    roles: [{
      name: "user",
      permissions: [{ name: "*" }],
    }],
  });
}
```

- Including a `$realm` in your app automatically enables security check.
- System is permission based by default. You can define roles and permissions as needed.
- Alepha generates permissions automatically for each action (e.g., `module:action`).
- `$realm` is considered low-level. You usually want to use high-level `$userRealm` for full user management.

Use `$realm` directly when:
*   You're integrating with an external identity provider (Keycloak, Auth0, Okta).
*   You need fine-grained control over token lifetimes and claims.
*   You're building a custom authentication flow.

### `$auth`: Login Flows

The `$auth` primitive handles *how* users authenticate. It supports three strategies:

```typescript
import { $auth } from "alepha/server/auth";

class AuthProviders {
  // 1. Credentials: username/password
  credentials = $auth({
    realm: this.security.internal,
    credentials: {
      account: async ({ username, password }) => {
        // Your validation logic here
        return await this.validateUser(username, password);
      }
    }
  });

  env = $env(t.object({
    GITHUB_CLIENT_ID: t.string(),
    GITHUB_CLIENT_SECRET: t.string(),
  }));

  // 2. OAuth2: external provider (manual config)
  github = $auth({
    realm: this.security.internal,
    oauth: {
      clientId: this.env.GITHUB_CLIENT_ID,
      clientSecret: this.env.GITHUB_CLIENT_SECRET,
      authorization: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      scope: "user:email",
      userinfo: async (tokens) => {
        // Fetch user profile from GitHub API
        return await fetchGitHubUser(tokens.access_token);
      },
    }
  });
}
```

## The High-Level Way (Recommended)

For most SaaS applications, you don't want to wire all this yourself. Alepha provides `$userRealm`—an extension of `$realm` that includes:
*   User accounts stored in your database
*   Password hashing (Scrypt)
*   Session management
*   Email verification hooks

```typescript
import { $userRealm } from "alepha/api/users";
import { $env, t } from "alepha";

class AppSecurity {
  env = $env(t.object({
    APP_SECRET: t.string(),
  }));

  realm = $userRealm({
    secret: this.env.APP_SECRET,
    settings: {
      registrationAllowed: true,
      emailRequired: true,
    },
    identities: {
      google: true,
    }
  });
}
```

### Auth Presets

Similarly, instead of configuring OAuth2 manually, use the presets:

```typescript
import { $authGoogle, $authGithub, $authCredentials } from "alepha/server/auth";

class AuthProviders {
  // Username/password with your $userRealm
  credentials = $authCredentials(this.authSystem.realm);

  // Google OAuth2 (auto-configured)
  google = $authGoogle(this.authSystem.realm, {
    clientId: "...",
    clientSecret: "...",
  });

  // GitHub OAuth2 (auto-configured)
  github = $authGithub(this.authSystem.realm, {
    clientId: "...",
    clientSecret: "...",
  });
}
```

## Protecting Routes

To protect an endpoint, tell the `$action` who is allowed in.

- $action: By default, only authenticated users can access.
- $route: `secure: true` to require authentication.

```typescript
class UserController {
  // Only logged-in users can see this
  getProfile = $action({
    path: "/me",
    handler: async ({ user }) => {
      return user;
    }
  });

  noAuthNeeded = $action({
    secure: false,
    handler: () => "This is public!",
  });
}
```

## Frontend Integration

On the client (React), you don't need to manage tokens manually. Alepha handles the cookies for you.

```tsx
import { useAuth } from "@alepha/react/auth";

const LoginButton = () => {
  const auth = useAuth();

  if (auth.user) {
    return <div>Welcome, {auth.user.name}</div>;
  }

  return (
    <button onClick={() => auth.login("google")}>
      Sign in with Google
    </button>
  );
};
```

That's it. No complex contexts, no interceptors. It just works.
