# Alepha - Server Auth

## Installation

Part of the `alepha` package. Import from `alepha/server/auth`.

```bash
npm install alepha
```

## Overview

OAuth2/OIDC authentication with social login providers.

**Features:**
- OAuth authentication provider
- Username/password authentication
- Google OAuth integration
- GitHub OAuth integration
- Apple OAuth integration
- Cookie-based, SSR-friendly authentication
- Token management and refresh

## API Reference

### Primitives

- [`$auth`](/docs/reference-primitives-$auth) — Creates an authentication provider primitive for handling user login flows.
- [`$authApple`](/docs/reference-primitives-$authapple) — TODO: Implement Apple authentication
- [`$authCredentials`](/docs/reference-primitives-$authcredentials) — Already configured Credentials authentication primitive.
- [`$authGithub`](/docs/reference-primitives-$authgithub) — Already configured GitHub authentication primitive.
- [`$authGoogle`](/docs/reference-primitives-$authgoogle) — Already configured Google authentication primitive.
