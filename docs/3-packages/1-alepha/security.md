# Alepha - Security

## Installation

Part of the `alepha` package. Import from `alepha/security`.

```bash
npm install alepha
```

## Overview

Provides comprehensive authentication and authorization capabilities with JWT tokens, role-based access control, and user management.

The security module enables building secure applications using primitives like `$issuer`, `$role`, and `$permission`
on class properties. It offers JWT-based authentication, fine-grained permissions, service accounts, and seamless
integration with various authentication providers and user management systems.

When used with `AlephaServer`, this module automatically registers `ServerSecurityProvider` and `ServerBasicAuthProvider`
to protect HTTP routes and actions with JWT and Basic Auth.

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
