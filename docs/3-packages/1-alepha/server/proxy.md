# Alepha - Server Proxy

## Installation

Part of the `alepha` package. Import from `alepha/server/proxy`.

```bash
npm install alepha
```

## Overview

Plugin for Alepha that provides a proxy server functionality.

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $proxy()

Creates a proxy primitive to forward requests to another server.

This primitive enables you to create reverse proxy functionality, allowing your Alepha server
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
import { $proxy } from "alepha/server/proxy";

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
