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
- Facebook OAuth integration
- Microsoft Entra ID (Azure AD) integration
- France Connect integration
- Cookie-based, SSR-friendly authentication
- Token management and refresh

## API Reference

### Primitives

- [`$auth`](/docs/reference-primitives-$auth) - Creates an authentication provider primitive for handling user login flows.
- [`$authApple`](/docs/reference-primitives-$authapple) - Already configured Apple authentication primitive.
- [`$authCredentials`](/docs/reference-primitives-$authcredentials) - Already configured Credentials authentication primitive.
- [`$authFacebook`](/docs/reference-primitives-$authfacebook) - Already configured Facebook authentication primitive.
- [`$authFranceConnect`](/docs/reference-primitives-$authfranceconnect) - Creates an authentication provider primitive for France Connect.
- [`$authGithub`](/docs/reference-primitives-$authgithub) - Already configured GitHub authentication primitive.
- [`$authGoogle`](/docs/reference-primitives-$authgoogle) - Already configured Google authentication primitive.
- [`$authMicrosoft`](/docs/reference-primitives-$authmicrosoft) - Already configured Microsoft Entra ID (Azure AD) authentication primitive.
