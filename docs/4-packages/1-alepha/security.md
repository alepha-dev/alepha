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

- [`$basicAuth`](/docs/primitives-$basicauth) — Declares HTTP Basic Authentication for server routes.
- [`$issuer`](/docs/primitives-$issuer) — Create a new issuer.
- [`$permission`](/docs/primitives-$permission) — Create a new permission.
- [`$role`](/docs/primitives-$role) — Create a new role.
- [`$serviceAccount`](/docs/primitives-$serviceaccount) — Allow to get an access token for a service account.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### JwtProvider

Provides utilities for working with JSON Web Tokens (JWT).

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `APP_SECRET` | text | DEFAULT_APP_SECRET |  |
