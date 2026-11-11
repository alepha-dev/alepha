# In Front of a Third-Party API

An Alepha web module often sits in front of an API it does not own: a backend
written by another team, in another language, described by an OpenAPI
document. `$client` and `$remote` do not apply there. They take their types
from an `import type` of an Alepha controller and resolve paths through
`/api/_links`, which a foreign API does not serve.

What applies is `HttpClient`, the outbound client every Alepha call already
goes through, and a few habits around it. This page is the recipe: there is no
`$api` primitive and Alepha generates no client (see
[No generated clients](/docs/guides-server-http-links#no-generated-clients)).

## The call

Wrap the API in a service, one method per endpoint, each with a zod schema for
its response:

```typescript check
import { $inject, z } from "alepha";
import { HttpClient } from "alepha/server";

const customerSchema = z.object({
  id: z.text(),
  name: z.text(),
  email: z.text().optional(),
});

export class CustomerApi {
  protected readonly http = $inject(HttpClient);
  protected readonly base = "https://api.example.com";

  async get(id: string) {
    const { data } = await this.http.fetch(
      `${this.base}/customers/${encodeURIComponent(id)}`,
      { schema: { response: customerSchema } },
    );
    return data; // { id: string; name: string; email?: string }
  }

  async rename(id: string, name: string) {
    await this.http.fetch(`${this.base}/customers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }
}
```

What `HttpClient.fetch` gives such a call:

- **A typed, validated response.** With `schema.response` the body is decoded
  through the schema: the type is inferred from it, and a response that does
  not match fails at the boundary instead of three components later. Without a
  schema the data is untyped.
- **Cancellation.** On the server the call runs under the request's signal, so
  a visitor who leaves stops the calls their page made
  ([Cancellation](/docs/guides-core-cancellation)).
- **A timeout.** 30 seconds by default on the server, `timeout` per call, and
  the `httpClientOptions` atom for the whole app.
- **Errors.** A 4xx or 5xx rejects with an `HttpError` carrying the status and
  the API's own message, whether it answered JSON or text.
- **A `client` span** per call when tracing is on.

The path, the query and the body are not typed: they are strings and
`RequestInit`, as `fetch` takes them. The method is where they get a type.

## A large surface

For an API with hundreds of endpoints, writing a schema per response is
work worth skipping where the response is only displayed. Types derived from
the API's OpenAPI document (with a generator of your choice, run in your own
build) plug in at the same place: the service method's signature.

```typescript check
import { $inject } from "alepha";
import { HttpClient } from "alepha/server";

// What a generator writes from the OpenAPI document, reduced to one path.
interface paths {
  "/invoices/{id}": {
    get: { response: { id: string; total: number; currency: string } };
  };
}

type Invoice = paths["/invoices/{id}"]["get"]["response"];

export class InvoiceApi {
  protected readonly http = $inject(HttpClient);

  async get(id: string): Promise<Invoice> {
    const { data } = await this.http.fetch(
      `https://api.example.com/invoices/${encodeURIComponent(id)}`,
    );
    return data as Invoice;
  }
}
```

⚠️ **Such types are compile-time only.** Nothing checks that the API answered
what its document says: the cast above is a promise, not a proof. Pass a
`schema.response` where a wrong shape would do harm (money, permissions,
anything written back), and keep the cast for what is only shown.

A typed client library of your choice works the same way: call it from the
service, and hand it Alepha's signal and timeout so it stops with the request.

## From a page

A page loader runs on the server for the first render and in the browser on
navigation; both call the same service.

```tsx check
import { $inject, z } from "alepha";
import { $page } from "alepha/react/router";
import { HttpClient } from "alepha/server";

const customerSchema = z.object({ id: z.text(), name: z.text() });

class CustomerApi {
  protected readonly http = $inject(HttpClient);

  async get(id: string) {
    const { data } = await this.http.fetch(
      `https://api.example.com/customers/${encodeURIComponent(id)}`,
      { schema: { response: customerSchema } },
    );
    return data;
  }
}

export class AppRouter {
  protected readonly customers = $inject(CustomerApi);

  customer = $page({
    path: "/customers/:id",
    schema: { params: z.object({ id: z.text() }) },
    loader: async ({ params }) => ({
      customer: await this.customers.get(params.id),
    }),
    component: ({ customer }) => <h1>{customer.name}</h1>,
  });
}
```

Data a component fetches after the page rendered goes through `useQuery`, which
gives it a key, cancellation on unmount and the app's error toaster
([React](/docs/guides-frontend-react)):

```tsx check
import { $inject, z } from "alepha";
import { useInject, useQuery } from "alepha/react";
import { HttpClient } from "alepha/server";

const orderSchema = z.array(z.object({ id: z.text(), total: z.number() }));

class OrderApi {
  protected readonly http = $inject(HttpClient);

  async list(customerId: string, signal?: AbortSignal) {
    const { data } = await this.http.fetch(
      `https://api.example.com/customers/${encodeURIComponent(customerId)}/orders`,
      { schema: { response: orderSchema }, signal },
    );
    return data;
  }
}

export const Orders = (props: { customerId: string }) => {
  const orders = useInject(OrderApi);
  const query = useQuery(
    {
      key: ["orders", props.customerId],
      handler: ({ signal }) => orders.list(props.customerId, signal),
    },
    [props.customerId],
  );
  return (
    <ul>
      {query.data?.map((order) => (
        <li key={order.id}>{order.total}</li>
      ))}
    </ul>
  );
};
```

## Through the app's own origin

When the browser calls the API itself, CORS and a second origin come with it.
A `$proxy` puts the API under the app's own origin instead:

```typescript check
import { $proxy } from "alepha/server/proxy";

export class Gateway {
  api = $proxy({
    path: "/api-proxy/*",
    target: "https://api.example.com",
    rewrite: (url) => {
      url.pathname = url.pathname.replace("/api-proxy", "");
    },
    timeout: [10, "seconds"],
  });
}
```

By default the proxy sends **neither `Cookie` nor `Authorization`** upstream:
the session's cookie and its access token stay with the app. An API that
authenticates the caller from the same token says so with
`forward: ["authorization"]`; an API that takes a service token instead gets it
from `beforeRequest`. `websocket: true` forwards a WebSocket upgrade too. See
[Credentials stay home](/docs/guides-server-static-and-proxy#credentials-stay-home).

## Per environment

The API's address differs between staging and production. Declare it as an env
key the browser may read, and one build serves both:

```typescript check
import { $env, $inject, z } from "alepha";
import { HttpClient } from "alepha/server";

export class CustomerApi {
  protected readonly http = $inject(HttpClient);
  protected readonly env = $env(
    z.object({
      CUSTOMER_API_URL: z.text({
        browser: true,
        description: "Base URL of the customer API.",
      }),
    }),
  );

  async get(id: string) {
    const { data } = await this.http.fetch(
      `${this.env.CUSTOMER_API_URL}/customers/${encodeURIComponent(id)}`,
    );
    return data;
  }
}
```

The server reads it from its environment; the browser gets the same value, in
the page's head or in `config.js` for a static site. A key without
`browser: true` never leaves the server. See
[Reading a variable in the browser](/docs/guides-core-configurations#reading-a-variable-in-the-browser).

## In tests

`MemoryHttpClient` answers the API's routes in a spec, records every call and
refuses an unexpected one. Only the transport is replaced: the schema, the
timeout and the error mapping run as they do against the network.

```typescript check
import { $inject, Alepha, z } from "alepha";
import { HttpClient, MemoryHttpClient } from "alepha/server";
import { describe, expect, it } from "vitest";

class CustomerApi {
  protected readonly http = $inject(HttpClient);

  async get(id: string) {
    const { data } = await this.http.fetch(
      `https://api.example.com/customers/${id}`,
      { schema: { response: z.object({ id: z.text(), name: z.text() }) } },
    );
    return data;
  }
}

describe("CustomerApi", () => {
  it("reads a customer", async () => {
    const alepha = Alepha.create().with({
      provide: HttpClient,
      use: MemoryHttpClient,
    });
    const http = alepha.inject(MemoryHttpClient);
    http.on("GET", "https://api.example.com/customers/:id", ({ params }) => ({
      id: params.id,
      name: "Ada",
    }));

    const customer = await alepha.inject(CustomerApi).get("c1");

    expect(customer).toEqual({ id: "c1", name: "Ada" });
    expect(
      http.calls("GET", "https://api.example.com/customers/:id"),
    ).toHaveLength(1);
  });
});
```

Error statuses, network failures and latency are simulated per route. See
[External APIs](/docs/guides-testing-unit-tests#example-external-apis).
