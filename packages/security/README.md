# Alepha Security

Manage realms, roles, permissions, and JWT-based authentication.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/security
```
## Module

Provides comprehensive authentication and authorization capabilities with JWT tokens, role-based access control, and user management.

The security module enables building secure applications using descriptors like `$realm`, `$role`, and `$permission`
on class properties. It offers JWT-based authentication, fine-grained permissions, service accounts, and seamless
integration with various authentication providers and user management systems.

**Key Features:**
- Declarative realm definition with `$realm` descriptor for user authentication
- Role-based access control with `$role` descriptor
- Fine-grained permissions with `$permission` descriptor
- Service account management with `$serviceAccount` descriptor
- JWT token generation and validation
- OAuth integration and external provider support
- User session management and security hooks

**Basic Usage:**
```ts
import { Alepha, run, t } from "alepha";
import { AlephaSecurity, $realm, $role, $permission } from "alepha/security";

// Define user roles
const adminRole = $role({
  name: "admin",
  description: "Administrator with full access",
});

const userRole = $role({
  name: "user", 
  description: "Regular user with limited access",
});

// Define permissions
const readUsersPermission = $permission({
  name: "users:read",
  description: "Read user information",
});

const writeUsersPermission = $permission({
  name: "users:write",
  description: "Create and update users",
});

// Define authentication realm
class AuthSystem {
  userRealm = $realm({
    name: "users",
    roles: [adminRole, userRole],
    permissions: [readUsersPermission, writeUsersPermission],
    authenticate: async (token: string) => {
      // Validate user token and return user info
      const user = await validateUserToken(token);
      return {
        id: user.id,
        email: user.email,
        roles: user.roles,
        permissions: user.permissions,
      };
    },
  });
}

const alepha = Alepha.create()
  .with(AlephaSecurity)
  .with(AuthSystem);

run(alepha);
```

**OAuth Integration:**
```ts
import { $serviceAccount } from "alepha/security";

class OAuthSystem {
  googleAuth = $realm({
    name: "google-oauth",
    provider: "oauth",
    config: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: "https://myapp.com/auth/callback",
      scope: ["email", "profile"],
    },
    authenticate: async (oauthToken: string) => {
      const userInfo = await fetchGoogleUserInfo(oauthToken);
      return {
        id: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name,
        roles: ["user"],
      };
    },
  });

  serviceAccount = $serviceAccount({
    name: "api-service",
    permissions: ["api:read", "api:write"],
    secret: process.env.SERVICE_ACCOUNT_SECRET,
  });
}
```

**Role and Permission Management:**
```ts
class PermissionSystem {
  // Define hierarchical roles
  superAdminRole = $role({
    name: "super-admin",
    inherits: [adminRole],
    permissions: ["*"], // All permissions
  });

  moderatorRole = $role({
    name: "moderator",
    inherits: [userRole],
    permissions: ["posts:moderate", "comments:moderate"],
  });

  // Define resource-specific permissions
  postPermissions = [
    $permission({ name: "posts:create", description: "Create posts" }),
    $permission({ name: "posts:edit", description: "Edit posts" }),
    $permission({ name: "posts:delete", description: "Delete posts" }),
    $permission({ name: "posts:moderate", description: "Moderate posts" }),
  ];

  // Check permissions in application logic
  async checkUserPermission(userId: string, permission: string) {
    const user = await this.userRealm.getUser(userId);
    return user.permissions.includes(permission);
  }
}
```

**JWT Token Management:**
```ts
class TokenSystem {
  userTokens = $realm({
    name: "jwt-tokens",
    jwtConfig: {
      secret: process.env.JWT_SECRET,
      expiresIn: "24h",
      issuer: "myapp.com",
      audience: "myapp-users",
    },
    authenticate: async (jwtToken: string) => {
      // JWT validation is handled automatically
      // Return user data from token payload
      return jwtToken.payload;
    },
  });

  async generateUserToken(user: { id: string; email: string; roles: string[] }) {
    return await this.userTokens.generateToken({
      sub: user.id,
      email: user.email,
      roles: user.roles,
      iat: Date.now(),
    });
  }
}
```

## API Reference

### Descriptors

#### $permission()



#### $realm()



#### $role()



#### $serviceAccount()

Allow to get an access token for a service account.

You have some options to configure the service account:
- a OAUTH2 URL using client credentials grant type
- a JWT secret shared between the services

```ts
import { $serviceAccount } from "@alepha/security";

class MyService {
  serviceAccount = $serviceAccount({
    oauth2: {
      url: "https://example.com/oauth2/token",
      clientId: "your-client-id",
      clientSecret: "your-client-secret",
    }
  });

  async fetchData() {
    const token = await this.serviceAccount.token();
    // or
    const response = await this.serviceAccount.fetch("https://api.example.com/data");
  }
}
```

### Providers

#### JwtProvider

Provides utilities for working with JSON Web Tokens (JWT).
