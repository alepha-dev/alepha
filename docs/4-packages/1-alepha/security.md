# Alepha - Security

## Installation

Part of the `alepha` package. Import from `alepha/security`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.1.0 | node, bun, workerd, browser|

Complete authentication and authorization system with JWT, RBAC, and multi-issuer support.

**Features:**
- JWT token issuer with role definitions
- Role-based access control (RBAC)
- Fine-grained permissions
- HTTP Basic Authentication
- Service-to-service authentication
- Multi-issuer support for federated auth
- JWKS (JSON Web Key Set) for external issuers
- Token refresh logic
- User profile extraction from JWT

## API Reference

### Primitives

- [`$basicAuth`](/docs/reference-primitives-$basicauth) — Declares HTTP Basic Authentication for server routes.
- [`$issuer`](/docs/reference-primitives-$issuer) — Create a new issuer.
- [`$permission`](/docs/reference-primitives-$permission) — Create a new permission.
- [`$role`](/docs/reference-primitives-$role) — Create a new role.
- [`$secure`](/docs/reference-primitives-$secure) — * Restrict to a specific authentication realm.
- [`$serviceAccount`](/docs/reference-primitives-$serviceaccount) — Allow to get an access token for a service account.

### Providers

- [`JwtProvider`](/docs/reference-providers-jwtprovider) — Provides utilities for working with JSON Web Tokens (JWT).
- [`ServerCsrfProvider`](/docs/reference-providers-servercsrfprovider) — CSRF protection via Origin header validation.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `APP_SECRET` | text | DEFAULT_APP_SECRET |  |
