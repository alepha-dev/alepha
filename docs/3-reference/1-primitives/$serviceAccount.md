# $serviceAccount

## Import

```typescript
import { $serviceAccount } from "alepha/security";
```

## Overview

Allow to get an access token for a service account.

You have some options to configure the service account:
- a OAUTH2 URL using client credentials grant type
- a JWT secret shared between the services

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `gracePeriod` | `number; // Grace period in seconds before token expiration` | No |  |

## Examples

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

