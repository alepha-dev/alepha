# Alepha - Security

## Installation

Part of the `alepha` package. Import from `alepha/security`.

```bash
npm install alepha
```

## Overview

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

- [`$basicAuth`](/docs/reference-primitives-$basicauth) — Middleware that enforces HTTP Basic Authentication on the request.
- [`$issuer`](/docs/reference-primitives-$issuer) — Create a new issuer.
- [`$permission`](/docs/reference-primitives-$permission) — Create a new permission.
- [`$role`](/docs/reference-primitives-$role) — Create a new role.
- [`$secure`](/docs/reference-primitives-$secure) — * Restrict to specific issuers (realms).
- [`$serviceAccount`](/docs/reference-primitives-$serviceaccount) — Allow to get an access token for a service account.

### Providers

- [`JwtProvider`](/docs/reference-providers-jwtprovider) — Provides utilities for working with JSON Web Tokens (JWT).
