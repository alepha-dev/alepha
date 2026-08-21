# Building an API

Alepha provides type-safe HTTP endpoints through the `$action` primitive. Actions are class properties that define request schemas, response schemas, and handler logic in a single declaration.

## Quick Start

Scaffold a new project:

```bash
alepha init my-api
```

Every Alepha project ships with `src/api/` - a server entry point, a sample controller, and Zod schemas. Building an API-only service? Delete `src/web/` and the `WebModule` line from `main.server.ts`.

## Defining Actions

Actions are defined as class properties using `$action`. Each action becomes an HTTP endpoint.

```typescript
import { z } from "alepha";
import { $action } from "alepha/server";

class ProductController {
  list = $action({
    path: "/products",
    schema: {
      query: z.object({
        page: z.integer().default(1).optional(),
        limit: z.integer().default(10).optional(),
      }),
      // good practice is to move complex schemas to separate files (api/schemas/*) and import them
      response: z.array(
        z.object({
          id: z.uuid(),
          name: z.text(),
          price: z.number(),
        }),
      ),
    },
    handler: async ({ query }) => {
      return await this.repo.findMany({
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      });
    },
  });

  create = $action({
    method: "POST",
    path: "/products",
    schema: {
      body: z.object({
        name: z.text(),
        price: z.number(),
      }),
      response: z.object({ id: z.uuid(), name: z.text(), price: z.number() }),
    },
    handler: async ({ body }) => {
      return await this.repo.create(body);
    },
  });
}
```

## URL Generation

`$action` sits above `$route`: same pipeline, but all paths are prefixed with `/api` by default.

```typescript
$action({ path: "/users" }); // GET /api/users
$action({ path: "/users/:id" }); // GET /api/users/:id
```

The prefix is configurable via the `serverApiOptions` atom:

```typescript
import { serverApiOptions } from "alepha/server";

alepha.store.mut(serverApiOptions, (o) => ({ ...o, prefix: "/v1" }));
// now: GET /v1/users
```

If `path` is omitted, the property key is used:

```typescript
class App {
  listUsers = $action({ handler: () => [] });
  // GET /api/listUsers
}
```

When a `params` schema is provided and no `path` is set, path parameters are appended automatically:

```typescript
class App {
  getUser = $action({
    schema: { params: z.object({ id: z.uuid() }) },
    handler: async ({ params }) => {
      /* ... */
    },
  });
  // GET /api/getUser/:id
}
```

## HTTP Method

The method defaults to `GET`. If a `body` schema is provided, it defaults to `POST`. You can set it explicitly:

```typescript
update = $action({
  method: "PUT",
  path: "/products/:id",
  schema: {
    params: z.object({ id: z.uuid() }),
    body: z.object({ name: z.text(), price: z.number() }),
    response: z.object({ id: z.uuid(), name: z.text(), price: z.number() }),
  },
  handler: async ({ params, body }) => {
    return await this.repo.update(params.id, body);
  },
});
```

Supported methods: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`, `CONNECT`, `TRACE`.

## Schema Object

The `schema` option accepts up to five fields:

| Field      | Purpose                                 |
| ---------- | --------------------------------------- |
| `params`   | Path parameters (e.g. `/products/:id`)  |
| `query`    | URL query parameters                    |
| `body`     | Request body (JSON, text, or multipart) |
| `headers`  | Required request headers                |
| `response` | Response body shape                     |

All fields use Zod schemas via the `z` helper from `alepha`. The handler receives fully validated and typed request data.

## Groups

Actions in the same class share a group. The group defaults to the class name. Groups are used for OpenAPI tags and permission namespacing.

Override the group explicitly:

```typescript
class AdminController {
  group = "admin";

  listUsers = $action({
    group: this.group,
    handler: () => {
      /* ... */
    },
  });

  deleteUser = $action({
    group: this.group,
    handler: () => {
      /* ... */
    },
  });
}
```

## Disabling an Action

The `disabled` option prevents the route from being registered. Useful for feature flags:

```typescript
class App {
  env = $env(
    z.object({
      ENABLE_BETA: z.boolean().default(false),
    }),
  );

  beta = $action({
    disabled: !this.env.ENABLE_BETA,
    handler: () => "beta feature",
  });
}
```

A disabled action throws an error if called via `.run()`.

## Calling Actions Programmatically

Actions can be called directly (no HTTP overhead) or via HTTP:

```typescript
// Direct local call - runs the handler in-process
const result = await this.list.run({ query: { page: 1, limit: 10 } });

// Force HTTP call - sends an actual HTTP request to the server
const response = await this.list.fetch({ query: { page: 1, limit: 10 } });

// Calling the action itself is the same as .run() - always local, never HTTP
const same = await this.list({ query: { page: 1, limit: 10 } });
```

> For local-first-then-HTTP dispatch, use `$client` links, which work across process and network boundaries (see [HTTP Links](/docs/guides-server-http-links)). Calling controllers directly is not recommended for shared libraries.

## Streaming with SSE

For endpoints that stream data progressively (AI chat, progress updates, live feeds), use `$sse` instead of `$action`. It returns a `text/event-stream` response that the client consumes as an async iterable.

```typescript
import { z } from "alepha";
import { $sse } from "alepha/server";

class AiController {
  chat = $sse({
    schema: {
      body: z.object({ prompt: z.text() }),
      data: z.object({ token: z.text() }),
    },
    handler: async ({ body, emit }) => {
      for await (const token of generateTokens(body.prompt)) {
        emit({ token });
      }
      // stream auto-closes when handler returns
    },
  });
}
```

The handler receives `emit()` to push typed events and `close()` to end the stream early. The stream closes automatically when the handler returns. It also receives `signal`, an `AbortSignal` that fires when the client disconnects - check it in any long-running loop, or the handler keeps running for a reader that is gone.

On the client, SSE endpoints are consumed through the same `$client` proxy as actions:

```typescript
const ctrl = $client<AiController>();
const stream = await ctrl.chat({ body: { prompt: "hello" } });

for await (const chunk of stream) {
  console.log(chunk.token);
}
```

Key differences from `$action`:

- Method is always POST
- Response is `text/event-stream` (not JSON)
- Schema uses `data` (event shape) instead of `response`
- Client receives an async iterable instead of a single value
