# Alepha - Security

## Installation

Part of the `alepha` package. Import from `alepha/security`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | epic | stable |

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

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $basicAuth()

Declares HTTP Basic Authentication for server routes.
This primitive provides methods to protect routes with username/password authentication.

#### $issuer()

Create a new issuer.

An issuer is responsible for creating and verifying JWT tokens.
It can be internal (with a secret) or external (with a JWKS).

#### $permission()

Create a new permission.

#### $role()

Create a new role.

#### $serviceAccount()

Allow to get an access token for a service account.

You have some options to configure the service account:
- a OAUTH2 URL using client credentials grant type
- a JWT secret shared between the services

```ts
import { $serviceAccount } from "alepha/security";

class MyService {
  serviceAccount = $serviceAccount({
    oauth2: {
      url: "https://example.com/oauth2/token",
      clientId: "your-client-id",
      clientSecret: "your-client-secret",
    }
  });

  async fetchData() {
    const token = await this.serviceAccount.token();
    // or
    const response = await this.serviceAccount.fetch("https://api.example.com/data");
  }
}
```

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
