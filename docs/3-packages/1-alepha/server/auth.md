# Alepha - Server Auth

## Installation

Part of the `alepha` package. Import from `alepha/server/auth`.

```bash
npm install alepha
```

## Overview

Allow authentication services for server applications.
It provides login and logout functionalities.

There are multiple authentication providers available (e.g., Google, GitHub).
You can also delegate authentication to your own OIDC/OAuth2, for example using Keycloak or Auth0.

It's cookie-based and SSR friendly.

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $auth()

Creates an authentication provider primitive for handling user login flows.

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

#### $authCredentials()

Already configured Credentials authentication primitive.

Uses username and password to authenticate users.

#### $authGithub()

Already configured GitHub authentication primitive.

Uses OAuth2 to authenticate users via their GitHub accounts.
Upon successful authentication, it links the GitHub account to a user session.

Environment Variables:
- `GITHUB_CLIENT_ID`: The client ID obtained from the GitHub Developer Settings.
- `GITHUB_CLIENT_SECRET`: The client secret obtained from the GitHub Developer Settings.

#### $authGoogle()

Already configured Google authentication primitive.

Uses OpenID Connect (OIDC) to authenticate users via their Google accounts.
Upon successful authentication, it links the Google account to a user session.

Environment Variables:
- `GOOGLE_CLIENT_ID`: The client ID obtained from the Google Developer Console.
- `GOOGLE_CLIENT_SECRET`: The client secret obtained from the Google Developer Console.
