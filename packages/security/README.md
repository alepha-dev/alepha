# Alepha Security

Manage realms, roles, permissions, and JWT-based authentication.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/security
```

## API Reference

### Descriptors

#### $permission()



#### $realm()



#### $role()



#### $serviceAccount()

Allow to get an access token for a service account.

You have some options to configure the service account:
- a OAUTH2 URL using client credentials grant type
- a JWT secret shared between the services

```ts
import { $serviceAccount } from "@alepha/security";

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
