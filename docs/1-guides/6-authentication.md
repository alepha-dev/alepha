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

class Security {
  // Internal realm: you control the secret
  internal = $realm({
    name: "app",
    secret: process.env.APP_SECRET,
    roles: ["admin", "user"],
    settings: {
      accessToken: { expiration: [15, "minutes"] },
      refreshToken: { expiration: [30, "days"] },
    }
  });

  // External realm: validate tokens from Keycloak, Auth0, etc.
  external = $realm({
    name: "keycloak",
    jwks: () => "https://auth.example.com/realms/myrealm/protocol/openid-connect/certs",
  });
}
```

Use `$realm` directly when:
*   You're integrating with an external identity provider (Keycloak, Auth0, Okta).
*   You need fine-grained control over token lifetimes and claims.
*   You're building a custom authentication flow.

### `$auth`: Login Flows

The `$auth` primitive handles *how* users authenticate. It supports three strategies:

```typescript
import { $auth } from "alepha/server-auth";

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

  // 2. OAuth2: external provider (manual config)
  github = $auth({
    realm: this.security.internal,
    oauth: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorization: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      scope: "user:email",
      userinfo: async (tokens) => {
        // Fetch user profile from GitHub API
        return await fetchGitHubUser(tokens.access_token);
      },
    }
  });

  // 3. OIDC: OpenID Connect (auto-discovery)
  keycloak = $auth({
    oidc: {
      issuer: "https://auth.example.com/realms/myrealm",
      clientId: "my-app",
      clientSecret: process.env.KEYCLOAK_SECRET,
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
import { $userRealm } from "alepha/api-users";

class AuthSystem {
  realm = $userRealm({
    secret: process.env.APP_SECRET,
    settings: {
      registrationAllowed: true,
      emailRequired: true,
    }
  });
}
```

### Auth Presets

Similarly, instead of configuring OAuth2 manually, use the presets:

```typescript
import { $authGoogle, $authGithub, $authCredentials } from "alepha/server-auth";

class AuthProviders {
  // Username/password with your $userRealm
  credentials = $authCredentials(this.authSystem.realm);

  // Google OAuth2 (auto-configured)
  google = $authGoogle(this.authSystem.realm, {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });

  // GitHub OAuth2 (auto-configured)
  github = $authGithub(this.authSystem.realm, {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  });
}
```

Once registered, Alepha automatically creates the necessary endpoints:
*   `/api/oauth/login?provider=google`
*   `/api/oauth/callback`
*   `/api/_auth/token` (for credentials)

## Protecting Routes

To protect an endpoint, tell the `$action` who is allowed in.

```typescript
class UserApi {
  // Only logged-in users can see this
  getProfile = $action({
    path: "/me",
    secure: true,
    handler: async ({ user }) => {
      return user;
    }
  });

  // Only admins can delete things
  deleteEverything = $action({
    path: "/nuke",
    secure: { permission: "system:delete" },
    handler: async () => {
      // ...
    }
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
