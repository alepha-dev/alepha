# Alepha React Auth

Simplifies user authentication flows in React applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

The ReactAuthModule provides authentication services for React applications.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";

const alepha = Alepha.create()
	.with(AlephaReactAuth);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $auth()

Creates an authentication provider descriptor for handling user login flows.

Supports multiple authentication strategies: credentials (username/password), OAuth2,
and OIDC (OpenID Connect). Handles token management, user profile retrieval, and
integration with both external identity providers (Auth0, Keycloak) and internal realms.

**Authentication Types**: Credentials, OAuth2 (Google, GitHub), OIDC, External providers

```ts
class AuthProviders {
  // Internal credentials-based auth
  credentials = $auth({
    realm: this.userRealm,
    credentials: {
      account: async ({ username, password }) => {
        return await this.validateUser(username, password);
      }
    }
  });

  // External OIDC provider
  keycloak = $auth({
    oidc: {
      issuer: "https://auth.example.com",
      clientId: "my-app",
      clientSecret: "secret",
      redirectUri: "/auth/callback"
    }
  });
}
```
