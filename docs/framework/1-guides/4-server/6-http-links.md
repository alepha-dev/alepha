# HTTP Links

Alepha's link system provides type-safe cross-service communication through `$client` and `$remote`. The same API works for local calls (in-process), remote calls (HTTP), and browser-to-server calls.

## $client: Type-Safe Action Proxy

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

## Calling a Remote Alepha App

Give the scope a `hostname` and `$client` resolves against **that app's** action registry instead of anything local. Nothing else is needed: the calling process registers no actions, declares no routes and binds no port.

```typescript check
import { $env, z } from "alepha";
import { $action } from "alepha/server";
import { $client } from "alepha/server/links";

// The remote app's controller. In a real consumer this is an `import type`
// away - the type is erased at build time, so it costs nothing at runtime,
// but the source does have to be reachable from the caller.
class QualityController {
  pushQualityRun = $action({
    method: "POST",
    path: "/projects/:projectId/quality",
    schema: {
      params: z.object({ projectId: z.text() }),
      body: z.object({ coverage: z.number() }),
      response: z.object({ id: z.text() }),
    },
    handler: async ({ params, body }) => {
      return { id: `${params.projectId}:${body.coverage}` };
    },
  });
}

class CoverageReporter {
  env = $env(
    z.object({
      LORE_URL: z.text({ default: "https://lore.alepha.dev" }),
      LORE_API_KEY: z.text({ default: "" }),
    }),
  );

  lore = $client<QualityController>({
    hostname: String(this.env.LORE_URL),
    authorization: () => `Bearer ${this.env.LORE_API_KEY}`,
  });

  push = async (projectId: string, coverage: number) => {
    await this.lore.pushQualityRun({
      params: { projectId },
      body: { coverage },
    });
  };
}
```

Register `AlephaServerLinksClient` rather than `AlephaServerLinks` in such a process. It carries `$client`, `LinkProvider` and the HTTP client, and nothing that serves.

```typescript
import { Alepha } from "alepha";
import { AlephaServerLinksClient } from "alepha/server/links";

const alepha = Alepha.create()
  .with(AlephaServerLinksClient)
  .with(CoverageReporter);
```

### The credential

`authorization` takes a string or a thunk, and the thunk is awaited **per request** - a refreshing token is the reason it is accepted at all, and a client that resolved it once would work until the token expired and then fail for good.

It is sent with the registry fetch as well as with the calls, and that is not an optimisation. `/api/_links` prunes every action the caller may not invoke, so an anonymous fetch omits each `$secure` one and the call fails with `Action <name> not found` for a route that plainly exists and that you are plainly allowed to call.

Header precedence, weakest first:

| Source                             | Beats                         |
| ---------------------------------- | ----------------------------- |
| the ambient incoming request (ALS) | nothing - it only fills a gap |
| scope `headers`                    | ALS                           |
| scope `authorization`              | scope `headers`               |
| per-call `options.request.headers` | everything                    |

`authorization` is accepted without a `hostname`, and is applied wherever a request is actually made - which means it is **inert when the link resolves to a local handler**, because there is no request to carry it.

### What a remote client does not reach

- **`$sse`**. A local SSE action works through the handler branch and returns a real stream; a remote one would leave as a plain fetch, which answers with a response. It is dropped from the type of a client whose scope names a host, and refused by name at call time for one the type cannot narrow.
- **Anything the source is not reachable for.** The type comes from `import type`, so the controller's source has to be on disk. Generating types from `/api/_links` for a consumer with no source access is deliberately out of scope - see _No generated clients_ below.

### The registry is cached per host, per caller

One fetch per host, held for five minutes (`remoteRegistryTtl` on the links options atom) and then revalidated - the endpoint emits an ETag, so an expired entry costs a 304 rather than a payload. Two hosts are held independently; neither evicts the other. The cache key is the host plus a hash of the headers that identify you to it, never the credential itself, so one caller's registry is never served to another.

If the registry cannot be fetched, the failure says so and names the host. It does not fall back to an empty registry, which would report `Action not found` for a server that is merely down.

### `/api/_links` is public

The registry endpoint answers **any** caller, authenticated or not, with the anonymous action surface. That is how the browser bootstraps before login, and it is not new - but a remote client makes it a surface you rely on deliberately, so it is worth stating rather than discovering: the names, paths and methods of your unsecured actions are public.

Actions behind `$secure` are pruned from an anonymous response, and are listed under `restricted` only for callers who have authenticated.

### No generated clients

Alepha does not and will not generate API clients. The type-safe path is `import type`, and for consumers outside TypeScript the answer is `alepha/server/swagger`, which serves an OpenAPI document that a dedicated codegen tool can read. That is a standing principle, not a gap waiting to be filled.

## Virtual Actions

Each property on a `$client` proxy returns a `VirtualAction` with these methods:

| Method                 | Description                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `action(config)`       | Default call. Local-first - calls the handler directly if available, otherwise HTTP. |
| `action.run(config)`   | Same as calling the action directly. Local-first.                                    |
| `action.fetch(config)` | Always makes an HTTP request, even if the action is local.                           |
| `action.can()`         | Returns `true` if the current user has permission to call this action.               |

```typescript
// Direct call (local-first)
const product = await this.products.getProduct({ params: { id } });

// Force HTTP
const response = await this.products.getProduct.fetch({ params: { id } });

// Permission check
if (this.products.getProduct.can()) {
  // user has access
}
```

## $remote: Remote Service Access

`$remote` defines a connection to an external service. Use it when services run as separate deployments.

> **`$remote` or `$client({ hostname })`?** They overlap, and picking the wrong one is the usual mistake. `$remote` is service-to-service: it is declared as a primitive on a class, it belongs to an app you also run, and it can carry a service account and proxy the remote's endpoints through your own server. `$client({ hostname })` is a consumer calling an app it does not host - a CLI, a worker, a script - and it declares nothing, registers nothing and serves nothing.

```typescript check
import { $remote } from "alepha/server/links";
import { $env, z } from "alepha";

class Gateway {
  env = $env(
    z.object({
      PAYMENTS_URL: z.text({ default: "http://localhost:4000" }),
    }),
  );

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
  sa = $serviceAccount({
    oauth2: {
      url: "https://auth.internal/oauth2/token",
      clientId: "gateway",
      clientSecret: "your-client-secret",
    },
  });

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

`proxy` also accepts an object form - `proxy: { noInternal: true }` makes the remote reachable only through the proxy, not via internal `$client` calls - and `$remote` takes a `name` to label the link (defaults to the class member's name).

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
