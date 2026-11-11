# $auth

## Import

```typescript
import { $auth } from "alepha/server/auth";
```

## Overview

Creates an authentication provider primitive for handling user login flows.

Supports multiple authentication strategies: credentials (username/password), OAuth2,
and OIDC (OpenID Connect). Handles token management, user profile retrieval, and
integration with both external identity providers (Auth0, Keycloak) and internal realms.

**Authentication Types**: Credentials, OAuth2 (Google, GitHub), OIDC, External providers

## Options

| Option     | Type      | Required | Description                             |
| ---------- | --------- | -------- | --------------------------------------- |
| `name`     | `string`  | No       | Name of the identity provider           |
| `disabled` | `boolean` | No       | If true, auth provider will be skipped. |

## Examples

```ts
class AuthProviders {
  // Internal credentials-based auth
  credentials = $auth({
    realm: this.userRealm,
    credentials: {
      account: async ({ username, password }) => {
        return await this.validateUser(username, password);
      },
    },
  });

  // External OIDC provider: no user table, the provider's tokens are the
  // session. The callback is served at `/oauth/callback`.
  keycloak = $auth({
    oidc: {
      issuer: "https://auth.example.com/realms/acme",
      clientId: "my-app",
      clientSecret: "secret",
    },
  });

  // Verifies the provider's tokens, from its discovery.
  keycloakIssuer = $issuer({ oidc: () => this.keycloak });
}
```
