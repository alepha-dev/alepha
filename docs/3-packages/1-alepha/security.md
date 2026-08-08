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
- [`$owns`](/docs/reference-primitives-$owns) — Resource-scoped authorization gate.
- [`$permission`](/docs/reference-primitives-$permission) — Create a new permission.
- [`$role`](/docs/reference-primitives-$role) — Create a new role.
- [`$secure`](/docs/reference-primitives-$secure) — Middleware that enforces authentication and authorization.
- [`$serviceAccount`](/docs/reference-primitives-$serviceaccount) — Allow to get an access token for a service account.

### Providers

- [`JwtProvider`](/docs/reference-providers-jwtprovider) — Provides utilities for working with JSON Web Tokens (JWT).
- [`OwnedResourceProvider`](/docs/reference-providers-ownedresourceprovider) — Reads the resource resolved by `$owns` for the current request.
- [`PermissionRegistryProvider`](/docs/reference-providers-permissionregistryprovider) — Answers "does the caller hold this permission?" from the set the server sent
