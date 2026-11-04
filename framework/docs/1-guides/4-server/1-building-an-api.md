# Building an API

Alepha provides type-safe HTTP endpoints through the `$action` primitive. Actions are class properties that define request schemas, response schemas, and handler logic in a single declaration.

## Quick Start

Scaffold a new project:

```bash
npm create alepha my-api
```

Every Alepha project ships with `src/api/` - a server entry point, a sample controller, and Zod schemas. Building an API-only service? Delete `src/web/` and the `WebModule` line from `main.server.ts`.

## Defining Actions

Actions are defined as class properties using `$action`. Each action becomes an HTTP endpoint.

```typescript
import { z } from "alepha";
import { $action } from "alepha/server";

class ProductController {
  list = $action({
    method: "GET",
    path: "/products",
    schema: {
      query: z.object({
        page: z.integer().default(1),
        limit: z.integer().default(10),
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
$action({ method: "GET", path: "/users" }); // GET /api/users
$action({ method: "GET", path: "/users/:id" }); // GET /api/users/:id
```

The prefix is configurable via the `serverApiOptions` atom:

```typescript
import { serverApiOptions } from "alepha/server";

alepha.store.mut(serverApiOptions, (o) => ({ ...o, prefix: "/v1" }));
// now: GET /v1/users
```

`path` is required. It never derives from the property name, so renaming `getUser` to `findUser` cannot move a public URL. Every `:name` in it is declared in `schema.params`:

```typescript
class App {
  getUser = $action({
    method: "GET",
    path: "/users/:id",
    schema: { params: z.object({ id: z.uuid() }) },
    handler: async ({ params }) => {
      /* ... */
    },
  });
  // GET /api/users/:id
}
```

## HTTP Method

`method` is required, with or without a body. A read declares `method: "GET"`: it is a claim that the call changes nothing, which is what the HTTP client's ETag cache and request deduplication rely on, and what keeps a state-changing endpoint out of reach of a cross-site link (browsers send the `SameSite=Lax` session cookie on a top-level GET). Any other method is set the same way:

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

**`HEAD` is answered for free by every `GET` route.** A request the router
cannot match under `HEAD` is retried under `GET`, and the response is sent
without its body, keeping the status and the headers a `GET` would have sent -
including `content-length`, which describes the body that was not sent. That is
what an uptime monitor, a load balancer health check or a link checker expects,
and most of them use `HEAD`. Declaring a `HEAD` route explicitly still wins over
the fallback, and the fallback only ever reaches `GET`: a `POST`-only path stays
unreachable by `HEAD`.

## Schema Object

The `schema` option accepts up to five fields:

| Field      | Purpose                                 |
| ---------- | --------------------------------------- |
| `params`   | Path parameters (e.g. `/products/:id`)  |
| `query`    | URL query parameters                    |
| `body`     | Request body (JSON, text, or multipart) |
| `headers`  | Required request headers                |
| `response` | Response body shape                     |

All fields use Zod schemas via the `z` helper from `alepha`. The handler receives fully validated and typed request data: an invalid request is answered 400 before the handler runs.

The `response` schema works the other way. What the handler returns is encoded through it, so a property the schema does not declare is stripped rather than leaked. That holds for an object, record or array schema: a text, number or boolean `response` is not validated, and the value goes out as a string. Without a `response`, the handler's type allows a string, a `Buffer`, a stream or nothing, but not an object: add a schema to return JSON. An object that gets past the type still goes out through `JSON.stringify`, with nothing stripped.

## The Request

Besides the validated `params`, `query`, `body` and `headers`, the handler's argument carries what the server knows about the call:

| Field                            | What it holds                                                             |
| -------------------------------- | ------------------------------------------------------------------------- |
| `url`, `method`, `requestId`     | The request URL, its method and its id (from `X-Request-Id` or a new one) |
| `ip`, `host`, `protocol`         | The client address, the host it called and `"http"` or `"https"`          |
| `userAgent`, `isBot`, `isMobile` | The parsed `User-Agent`                                                   |
| `geo`, `language`, `referer`     | Location hints, the preferred language and the parsed `Referer`           |
| `signal`                         | An `AbortSignal` that fires when the client disconnects                   |
| `reply`                          | The response being built: `reply.setHeader()`, `reply.status`             |
| `metadata`                       | A free-form record middlewares use to pass data along                     |

Middlewares in `use` can add fields: `$secure()` adds a `user` the handler can read without checking it for `undefined`.

`ip` trusts proxy headers by default. With `TRUST_PROXY=true` it reads `cf-connecting-ip`, then the `X-Forwarded-For` entry `TRUST_PROXY_HOPS` (default 1) places from the right, then `X-Real-IP`, and only then the socket. A server that takes direct connections must set `TRUST_PROXY=false`, or a client chooses its own address, and with it its rate-limit key.

## Action Options

Beyond `method`, `path`, `schema` and `handler`:

| Option        | Effect                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `use`         | [Middlewares](/docs/guides-server-middlewares) around the handler, outermost first (`$secure()`, `$rateLimit`, `$etag()`)       |
| `errors`      | The errors the action answers with; anything else becomes a 500. See [Typed errors](/docs/guides-server-typed-errors)           |
| `timeout`     | How long the action may run (`[10, "seconds"]`) before it answers 503 with a `TimeoutError`; `false` opts out of the global one |
| `group`       | See [Groups](#groups)                                                                                                           |
| `description` | A short description for the [OpenAPI](/docs/guides-server-openapi) document                                                     |
| `name`        | The action's name, which defaults to the property name and feeds its permission name                                            |
| `silent`      | Keep the action's requests out of the request log                                                                               |
| `disabled`    | See [Disabling an Action](#disabling-an-action)                                                                                 |

No action has a timeout by default; the `serverApiOptions` atom's `timeout` (in milliseconds) sets one for all of them, and an action's own `timeout` wins. The deadline covers the `use` middlewares and the handler, and aborts the request's `signal`, the same object as `alepha.context.signal`, so that queries and outbound calls, which read it, stop too. Hand it to anything that takes a signal explicitly, like a bare `fetch`.

## Groups

Actions in the same class share a group. The group defaults to the class name. Groups are used for OpenAPI tags and permission namespacing.

Override the group explicitly:

```typescript
class AdminController {
  group = "admin";

  listUsers = $action({
    method: "GET",
    path: "/listUsers",
    group: this.group,
    handler: () => {
      /* ... */
    },
  });

  deleteUser = $action({
    method: "POST",
    path: "/deleteUser",
    group: this.group,
    handler: () => {
      /* ... */
    },
  });
}
```

## Disabling an Action

The `disabled` option prevents the route from being registered. Useful for feature flags:

```typescript check
import { $env, z } from "alepha";
import { $action } from "alepha/server";

class App {
  env = $env(
    z.object({
      ENABLE_BETA: z.boolean().default(false),
    }),
  );

  beta = $action({
    method: "POST",
    path: "/beta",
    disabled: !this.env.ENABLE_BETA,
    handler: () => "beta feature",
  });
}
```

A disabled action is not available locally either: calling it with `.run()` throws an `AlephaError`.

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
    path: "/chat",
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

The handler receives `emit()` to push typed events and `close()` to end the stream early. The stream closes automatically when the handler returns. `emit()` returns `false` once the stream is over (the client left or `close()` was called) and the event was dropped. It also receives `signal`, an `AbortSignal` that fires when the client disconnects - check it in any long-running loop, or the handler keeps running for a reader that is gone.

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
- `use` middlewares are accepted as on `$action` (`$secure()` refuses before the stream opens)
- Response is `text/event-stream` (not JSON)
- Schema uses `data` (event shape) instead of `response`
- Client receives an async iterable instead of a single value
