# Authentication & Security

In most frameworks, adding authentication involves:
1.  Installing Passport.js / NextAuth.
2.  Configuring a session store (Redis).
3.  Writing middleware to check headers.
4.  Manually hashing passwords.
5.  Praying you didn't leave a hole.

In Alepha, authentication is just another set of primitives.

## 1. The Realm

First, you need a **Realm**. Think of a Realm as a container for users, roles, and sessions.

```typescript
import { $userRealm } from "alepha/api/users";

class AuthSystem {
  // Creates a full user management system with 'admin' and 'user' roles.
  // It automatically handles:
  // - Password hashing (Scrypt)
  // - Session management (DB + Cookies)
  // - JWT signing
  realm = $userRealm({
    secret: process.env.APP_SECRET,
    settings: {
      registrationAllowed: true,
      emailRequired: true,
    }
  });
}
```

## 2. Login Providers

Now you need a way to get into that realm. We use the `$auth` primitive for this.

```typescript
import { $authGoogle, $authCredentials } from "alepha/server/auth";

class AuthProviders {
  // Standard Username/Password flow
  credentials = $authCredentials(this.authSystem.realm);

  // Google OAuth2
  google = $authGoogle(this.authSystem.realm, {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });
}
```

Once these are registered, Alepha automatically creates the necessary endpoints:
*   `/api/oauth/login?provider=google`
*   `/api/oauth/callback`
*   `/api/_auth/token` (for credentials)

## 3. Protecting Routes

To protect an endpoint, you just tell the `$action` who is allowed in.

```typescript
class UserApi {
  // Only logged-in users can see this
  getProfile = $action({
    path: "/me",
    // 'secure: true' means "User must be logged in"
    secure: true,
    handler: async ({ user }) => {
      return user;
    }
  });

  // Only admins can delete things
  deleteEverything = $action({
    path: "/nuke",
    secure: {
      // You can define permissions in your SecurityProvider
      permission: "system:delete"
    },
    handler: async () => {
      // ...
    }
  });
}
```

## 4. Frontend Integration

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
