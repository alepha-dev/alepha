# Alepha - Server Auth

## Installation

Part of the `alepha` package. Import from `alepha/server/auth`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.8.0 | node, bun, workerd|

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

- [`$auth`](/docs/primitives-$auth) — Creates an authentication provider primitive for handling user login flows.
- [`$authApple`](/docs/primitives-$authapple) — TODO: Implement Apple authentication
- [`$authCredentials`](/docs/primitives-$authcredentials) — Already configured Credentials authentication primitive.
- [`$authGithub`](/docs/primitives-$authgithub) — Already configured GitHub authentication primitive.
- [`$authGoogle`](/docs/primitives-$authgoogle) — Already configured Google authentication primitive.
