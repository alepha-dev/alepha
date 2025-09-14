# Alepha Security

Manage realms, roles, permissions, and JWT-based authentication.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides comprehensive authentication and authorization capabilities with JWT tokens, role-based access control, and user management.

The security module enables building secure applications using descriptors like `$realm`, `$role`, and `$permission`
on class properties. It offers JWT-based authentication, fine-grained permissions, service accounts, and seamless
integration with various authentication providers and user management systems.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaSecurity } from "alepha/security";

const alepha = Alepha.create()
	.with(AlephaSecurity);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $permission()

Create a new permission.

#### $realm()

Create a new realm.

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

For more details, see the [Providers documentation](/docs/providers).

#### JwtProvider

Provides utilities for working with JSON Web Tokens (JWT).
