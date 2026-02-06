# Authentication & Security

In most tools, adding authentication involves:
1.  Installing Passport.js / NextAuth.
2.  Configuring a session store (Redis).
3.  Writing middleware to check headers.
4.  Manually hashing passwords.
5.  Praying you didn't leave a hole.

In Alepha, authentication is built on two low-level primitives: `$issuer` and `$auth`. You can use them directly for full control, or use the higher-level presets for common scenarios.

## The Low-Level Primitives

### `$issuer`: Token Management

An **Issuer** is a JWT token provider. It handles JWT token creation, verification, and role management. It doesn't care *how* users authenticate—it just issues and validates tokens.

```typescript
import { $issuer } from "alepha/security";
import { $env, t } from "alepha";

class AppSecurity {
  env = $env(t.object({
    ISSUER_SECRET: t.string({ default: "***********" }),
  }))

  // Internal issuer: you control the secret, you can forge tokens
  internal = $issuer({
    name: "app",
    secret: this.env.ISSUER_SECRET,
    roles: [{
      name: "user",
      permissions: [{ name: "*" }],
    }],
    settings: {
      accessToken: { expiration: [15, "minutes"] },
      refreshToken: { expiration: [30, "days"] },
    }
  });

  // External issuer (delegation): validate tokens from Keycloak, Auth0, etc. You can't forge tokens here.
  external = $issuer({
    name: "keycloak",
    jwks: () => "https://auth.example.com/realms/myrealm/protocol/openid-connect/certs",
    roles: [{
      // Map role "user" to all permissions
      name: "user",
      permissions: [{ name: "*" }],
    }],
  });
}
```

- Including an `$issuer` in your app automatically enables security check.
- System is permission based by default. You can define roles and permissions as needed.
- Alepha generates permissions automatically for secured actions (those with `secure: true`).
- `$issuer` is considered low-level. You usually want to use high-level `$realm` for full user management.

Use `$issuer` directly when:
*   You're integrating with an external identity provider (Keycloak, Auth0, Okta).
*   You need fine-grained control over token lifetimes and claims.
*   You're building a custom authentication flow.

### `$auth`: Login Flows

The `$auth` primitive handles *how* users authenticate. It supports multiple strategies:

```typescript
import { $auth } from "alepha/server/auth";

class AuthProviders {
  env = $env(t.object({
    GITHUB_CLIENT_ID: t.string(),
    GITHUB_CLIENT_SECRET: t.string(),
    KEYCLOAK_URL: t.string(),
  }));

  // 1. Credentials: username/password
  credentials = $auth({
    issuer: this.security.internal,
    credentials: {
      account: async ({ username, password }) => {
        // Your validation logic here
        return await this.validateUser(username, password);
      }
    }
  });

  // 2. OAuth2: external provider (manual config)
  github = $auth({
    issuer: this.security.internal,
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

  // 3. OIDC: OpenID Connect (Keycloak, Auth0, Okta, etc.)
  keycloak = $auth({
    oidc: {
      issuer: `${this.env.KEYCLOAK_URL}/realms/customers`,
      clientId: "my-app",
    },
    fallback: () => generateAnonymousToken(), // Optional: return anonymous token if not authenticated
  });
}
```

The `oidc` strategy auto-discovers endpoints from the issuer's `.well-known/openid-configuration`.
No manual URL wiring needed—just point it at your identity provider and go.

## The High-Level Way (Recommended)

For most SaaS applications, you don't want to wire all this yourself. Alepha provides `$realm`—an extension of `$issuer` that includes:
*   User accounts stored in your database
*   Password hashing (Scrypt)
*   Session management
*   Email verification hooks

```typescript
import { $realm } from "alepha/api/users";

class AppSecurity {
  realm = $realm({
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
  // Username/password with your $realm
  credentials = $authCredentials(this.realm);

  // Google OAuth2 (auto-configured)
  google = $authGoogle(this.realm, {
    clientId: "...",
    clientSecret: "...",
  });

  // GitHub OAuth2 (auto-configured)
  github = $authGithub(this.realm, {
    clientId: "...",
    clientSecret: "...",
  });
}
```

## Protecting Routes

Both `$action` and `$route` are **public by default**. Use `secure: true` to require authentication.

| `secure` value | Behavior |
|----------------|----------|
| `undefined` | Public with optional auth (user resolved if token present) |
| `false` | Public, skip auth entirely |
| `true` | Required authentication |
| `{ realm: "x" }` | Required auth + realm check |

```typescript
class UserController {
  // Protected: requires authentication
  getProfile = $action({
    secure: true,
    path: "/me",
    handler: async ({ user }) => {
      return user;
    }
  });

  // Public: no auth required (default behavior)
  publicEndpoint = $action({
    handler: () => "This is public!",
  });

  // Public with optional auth: user is available if logged in
  homepage = $action({
    handler: ({ user }) => {
      if (user) {
        return `Welcome back, ${user.name}!`;
      }
      return "Welcome, guest!";
    },
  });
}
```

## Frontend Integration

On the client (React), you don't need to manage tokens manually. Alepha handles the cookies for you.

```tsx
import { useAuth } from "alepha/react/auth";
import type { AuthProviders } from "./AuthProviders";

const LoginPage = () => {
  // Type parameter gives you autocomplete for provider names
  const auth = useAuth<AuthProviders>();

  if (auth.user) {
    return (
      <div>
        <p>Welcome, {auth.user.name}</p>
        <button onClick={() => auth.logout()}>Logout</button>
      </div>
    );
  }

  return (
    <div>
      {/* OAuth/OIDC: redirects to provider */}
      <button onClick={() => auth.login("keycloak")}>
        Sign in with Keycloak
      </button>
      <button onClick={() => auth.login("github")}>
        Sign in with GitHub
      </button>

      {/* Credentials: pass username/password directly */}
      <form onSubmit={(e) => {
        e.preventDefault();
        auth.login("credentials", {
          username: email,
          password: password,
        });
      }}>
        <input type="email" placeholder="Email" />
        <input type="password" placeholder="Password" />
        <button type="submit">Sign in</button>
      </form>
    </div>
  );
};
```

The generic type `useAuth<AuthProviders>()` gives you autocomplete for provider names—no more typos.
OAuth providers redirect to the identity provider; credentials submit directly.

### Permission Checking

The `can()` helper checks if the current user has permission to call an action:

```tsx
const AdminPanel = () => {
  const auth = useAuth<AuthProviders>();

  // Check permission before showing UI
  if (!auth.can("deleteUser")) {
    return <p>Access denied</p>;
  }

  return <button>Delete User</button>;
};
```

That's it. No complex contexts, no interceptors. It just works.
