# HTTP Links

Alepha's link system provides type-safe cross-service communication through `$client` and `$remote`. The same API works for local calls (in-process), remote calls (HTTP), and browser-to-server calls.

## $client -- Type-Safe Action Proxy

`$client<T>()` creates a proxy object that mirrors the actions of a controller class. Property access on the proxy returns virtual actions that can be called like functions.

```typescript
import { $client } from "alepha/server/links";
import { $action } from "alepha/server";
import { z } from "alepha";

class ProductController {
  getProduct = $action({
    path: "/products/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ id: z.uuid(), name: z.text(), price: z.number() }),
    },
    handler: async ({ params }) => {
      return await this.repo.findById(params.id);
    },
  });
}

class OrderService {
  products = $client<ProductController>();

  createOrder = $action({
    method: "POST",
    path: "/orders",
    schema: {
      body: z.object({ productId: z.uuid(), quantity: z.integer() }),
    },
    handler: async ({ body }) => {
      // Type-safe call: params type is inferred from ProductController.getProduct
      const product = await this.products.getProduct({
        params: { id: body.productId },
      });
      return { product: product.name, total: product.price * body.quantity };
    },
  });
}
```

### Local vs Remote Resolution

When the target action exists in the same process, `$client` calls the handler directly with no HTTP overhead. When the action is on a remote service, it makes an HTTP request. This is transparent to the caller.

## Virtual Actions

Each property on a `$client` proxy returns a `VirtualAction` with these methods:

| Method | Description |
|--------|-------------|
| `action(config)` | Default call. Local-first -- calls the handler directly if available, otherwise HTTP. |
| `action.run(config)` | Same as calling the action directly. Local-first. |
| `action.fetch(config)` | Always makes an HTTP request, even if the action is local. |
| `action.can()` | Returns `true` if the current user has permission to call this action. |
| `action.schema()` | Returns the body and response schemas of the action. |

```typescript
// Direct call (local-first)
const product = await this.products.getProduct({ params: { id } });

// Force HTTP
const response = await this.products.getProduct.fetch({ params: { id } });

// Permission check
if (this.products.getProduct.can()) {
  // user has access
}

// Schema introspection
const schemas = this.products.getProduct.schema();
// schemas.body, schemas.response
```

## $remote -- Remote Service Access

`$remote` defines a connection to an external service. Use it when services run as separate deployments.

```typescript check
import { $remote } from "alepha/server/links";
import { $env, z } from "alepha";

class Gateway {
  env = $env(z.object({
    PAYMENTS_URL: z.text({ default: "http://localhost:4000" }),
  }));

  payments = $remote({
    url: this.env.PAYMENTS_URL,
  });
}
```

> Auto-discovery of remote services is not currently supported. The `$remote` URL must be configured manually. Future versions may support service discovery via Redis.

### Service Account Authentication

For authenticated service-to-service communication, attach a service account:

```typescript
import { $remote } from "alepha/server/links";
import { $serviceAccount } from "alepha/security";

class Gateway {
  sa = $serviceAccount({ secret: "shared-secret" });

  payments = $remote({
    url: "https://payments.internal",
    serviceAccount: this.sa,
  });
}
```

### Proxying

Set `proxy: true` to expose the remote service's endpoints through the current server:

```typescript
payments = $remote({
  url: "https://payments.internal",
  proxy: true,
});
// Remote endpoints are now accessible via this server
```

This is useful when you have a backend-for-frontend (BFF) pattern and want to aggregate multiple services under a single API.

## Browser Usage

In React, use `useClient<T>()` to call server actions from the browser:

```typescript
import { useClient } from "alepha/react";

function ProductPage() {
  const api = useClient<ProductController>();

  const loadProduct = async (id: string) => {
    const product = await api.getProduct({ params: { id } });
    // product is fully typed
  };
}
```

In the browser, all calls go through HTTP. During SSR, local actions are called directly.

## How Links Work

The `LinkProvider` maintains a registry of all available actions (local and remote). When a `$client` proxy is accessed:

1. It looks up the action by name in the link registry.
2. If the action has a local handler (same process), it calls the handler directly.
3. If the action is remote (has a `host`), it makes an HTTP request via `HttpClient`.
4. Authorization headers from the current request context are forwarded automatically.

The proxy is built using JavaScript `Proxy`, so property access is intercepted at runtime and mapped to link lookups.

