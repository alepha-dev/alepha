# Alepha Server Proxy

Reverse-proxies incoming requests to other backend services.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server-proxy
```

## Module

Plugin for Alepha that provides a proxy server functionality.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServerProxy } from "alepha/server/proxy";

const alepha = Alepha.create()
	.with(AlephaServerProxy);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

For more details, see the [Descriptors documentation](https://feunard.github.io/alepha/docs/descriptors).

#### $proxy()

Creates a proxy descriptor to forward requests to another server.

This descriptor enables you to create reverse proxy functionality, allowing your Alepha server
to forward requests to other services while maintaining a unified API surface. It's particularly
useful for microservice architectures, API gateways, or when you need to aggregate multiple
services behind a single endpoint.

**Key Features**

- **Path-based routing**: Match specific paths or patterns to proxy
- **Dynamic targets**: Support both static and dynamic target resolution
- **Request/Response hooks**: Modify requests before forwarding and responses after receiving
- **URL rewriting**: Transform URLs before forwarding to the target
- **Conditional proxying**: Enable/disable proxies based on environment or conditions

**Basic proxy setup:**
```ts
import { $proxy } from "@alepha/server-proxy";

class ApiGateway {
  // Forward all /api/* requests to external service
  api = $proxy({
    path: "/api/*",
    target: "https://api.example.com"
  });
}
```

**Dynamic target with environment-based routing:**
```ts
class ApiGateway {
  // Route to different environments based on configuration
  api = $proxy({
    path: "/api/*",
    target: () => process.env.NODE_ENV === "production"
      ? "https://api.prod.example.com"
      : "https://api.dev.example.com"
  });
}
```

**Advanced proxy with request/response modification:**
```ts
class SecureProxy {
  secure = $proxy({
    path: "/secure/*",
    target: "https://secure-api.example.com",
    beforeRequest: async (request, proxyRequest) => {
      // Add authentication headers
      proxyRequest.headers = {
        ...proxyRequest.headers,
        'Authorization': `Bearer ${await getServiceToken()}`,
        'X-Forwarded-For': request.headers['x-forwarded-for'] || request.ip
      };
    },
    afterResponse: async (request, proxyResponse) => {
      // Log response for monitoring
      console.log(`Proxied ${request.url} -> ${proxyResponse.status}`);
    },
    rewrite: (url) => {
      // Remove /secure prefix when forwarding
      url.pathname = url.pathname.replace('/secure', '');
    }
  });
}
```

**Conditional proxy based on feature flags:**
```ts
class FeatureProxy {
  newApi = $proxy({
    path: "/v2/*",
    target: "https://new-api.example.com",
    disabled: !process.env.ENABLE_V2_API // Disable if feature flag is off
  });
}
```
