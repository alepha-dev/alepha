# @alepha/react - Auth

## Installation

This module is part of the Alepha framework:

```bash
npm install @alepha/react
```

## Overview

The ReactAuthModule provides authentication services for React applications.

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

#### $authApple()

TODO: Implement Apple authentication

#### $authGithub()

Already configured GitHub authentication descriptor.

Uses OAuth2 to authenticate users via their GitHub accounts.
Upon successful authentication, it links the GitHub account to a user session.

Environment Variables:
- `GITHUB_CLIENT_ID`: The client ID obtained from the GitHub Developer Settings.
- `GITHUB_CLIENT_SECRET`: The client secret obtained from the GitHub Developer Settings.

#### $authGoogle()

Already configured Google authentication descriptor.

Uses OpenID Connect (OIDC) to authenticate users via their Google accounts.
Upon successful authentication, it links the Google account to a user session.

Environment Variables:
- `GOOGLE_CLIENT_ID`: The client ID obtained from the Google Developer Console.
- `GOOGLE_CLIENT_SECRET`: The client secret obtained from the Google Developer Console.
