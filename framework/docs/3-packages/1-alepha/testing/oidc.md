# Alepha - Testing Oidc

## Installation

Part of the `alepha` package. Import from `alepha/testing/oidc`.

```bash
npm install alepha
```

## Overview

A mock OpenID Connect provider, for testing an app that signs its users in
through an external identity provider.

**Features:**

- Discovery, authorize, token, JWKS, end-session and revocation endpoints,
  at Keycloak's paths
- PKCE, client secrets and refresh tokens checked as a real provider does
- Claims, token lifetime and advertised endpoints chosen by the test
- Back-channel logout tokens, delivered to the app

## API Reference

### Providers

- [`MockOidcProvider`](/docs/reference-providers-mockoidcprovider) - An OpenID Connect provider for tests: discovery, authorize, token, JWKS,
