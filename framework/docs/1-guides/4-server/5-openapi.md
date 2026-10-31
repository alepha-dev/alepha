# OpenAPI Documentation

Alepha auto-generates OpenAPI 3.0 specifications from your `$action` definitions using the `$swagger` primitive.

## Setup

```typescript check
import { $swagger } from "alepha/server/swagger";

class App {
  docs = $swagger({
    info: {
      title: "My API",
      version: "1.0.0",
      description: "Product catalog REST API",
    },
  });
}
```

This serves:

- Interactive Swagger UI at `/docs`
- OpenAPI JSON at `/docs/json`

## Configuration

The `$swagger` primitive accepts these options:

| Option        | Default                                            | Description                                                                                 |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `info`        | `{ title: "API Documentation", version: "1.0.0" }` | OpenAPI info block                                                                          |
| `prefix`      | `"/docs"`                                          | Base path for documentation endpoints                                                       |
| `disabled`    | `false`                                            | Disable documentation entirely                                                              |
| `excludeTags` | `[]`                                               | Tag names to hide from documentation                                                        |
| `ui`          | `true`                                             | Enable/disable Swagger UI, or pass UI options (`root`, `persistAuthorization`, `initOAuth`) |
| `rewrite`     | -                                                  | Function to modify the generated OpenAPI document                                           |
| `servers`     | server hostname                                    | OpenAPI `servers` array                                                                     |

`ui: false` serves the JSON document alone. Pass an object to configure the UI: `persistAuthorization` (default `true`) keeps the token you enter across reloads, and `root` points at your own Swagger UI assets. Only the first `$swagger` in the app is read, and on a serverless runtime only the JSON document and the UI's initializer are served, since there is no filesystem to serve the UI's assets from.

### Custom Prefix

```typescript
docs = $swagger({
  prefix: "/api-docs",
  info: { title: "My API", version: "2.0.0" },
});
// Swagger UI at /api-docs, JSON at /api-docs/json
```

### Excluding Tags

Tags correspond to action groups (class names by default). Hide internal endpoints:

```typescript
docs = $swagger({
  info: { title: "Public API", version: "1.0.0" },
  excludeTags: ["InternalController", "admin"],
});
```

### Rewriting the Document

Modify the generated OpenAPI document before it is served:

```typescript
docs = $swagger({
  info: { title: "My API", version: "1.0.0" },
  rewrite: (doc) => {
    doc.components ??= {};
    doc.components.securitySchemes = {
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    };
  },
});
```

## How Actions Map to OpenAPI

Each `$action` with a `schema` becomes an OpenAPI operation; an action without one is left out of the document:

- **Operation ID**: The action name (property key or explicit `name`).
- **Tag**: The action group (class name or explicit `group`). Colons render as separators: group `admin:files` becomes tag `admin / files`, while `excludeTags` still matches the raw `admin:files`.
- **Summary/Description**: From the `summary` and `description` options on `$action`. Importing `alepha/server/swagger` adds `summary`, `hide` and `deprecated` to the `$action` options: `hide: true` drops the operation from the document, `deprecated: true` flags it.
- **Parameters**: Generated from `schema.params` (path) and `schema.query` (query). A query parameter is `required` unless it is optional or has a default, and a schema's `example` (or first `examples` entry) is carried over.
- **Request Body**: Generated from `schema.body`. Objects become `application/json`; a body with a `z.file()` or `z.stream()` field becomes `multipart/form-data`, the file as a `binary` string.
- **Response**: Generated from `schema.response`. Objects and arrays are `application/json`, strings and scalars `text/plain` (as the router serves them), a `z.file()` `application/octet-stream`. A `400 Bad Request` is added when the action validates a body, query or params, and an action with no `response` schema is documented as `204 No Content`.

A schema carrying a `title` in its metadata (`z.object({...}).meta({ title: "Product" })`) is hoisted into `components/schemas` and referenced with `$ref`, so a shared schema appears once in the document.

Schema descriptions propagate to OpenAPI field descriptions:

```typescript
schema: {
  body: z.object({
    email: z.email().describe("User's email address"),
    age: z.integer().describe("User's age in years"),
  }),
}
```

## Security in OpenAPI

Actions that carry the `$secure` middleware (`use: [$secure(...)]`) are documented with a Bearer JWT security requirement; the `bearerAuth` scheme is emitted whenever at least one such action exists. Actions without `$secure` carry no security requirement.

The test is not the middleware's name but its `MIDDLEWARE_PROTECTED` flag, so a middleware of your own that sets it is documented the same way. Every secured action also gets a `401 Unauthorized` response. Only the action's own `use` counts: a `$secure()` applied through a path-scoped `$middleware` gates the route and documents nothing.

## Documented Errors

An action that declares [`errors`](/docs/guides-server-typed-errors) documents the responses it can actually give:

- the statuses its middlewares declare in their `MIDDLEWARE_RESPONSES` meta (`$secure()` 401, plus 403 with roles or permissions; `$rateLimit` 429);
- each declared error under its status, with its code and `data` schema, as a `oneOf` when two share a status;
- the `500` any undeclared error becomes.

An action with a timeout, its own or the global one, documents the `503` of its `TimeoutError`, with or without `errors`. Without `errors`, no other error response is documented beyond the `400` and the `401` of a secured action.

Keys you never want in the document can be stripped everywhere with the `swaggerOptions` atom: `alepha.store.mut(swaggerOptions, (o) => ({ ...o, excludeKeys: ["internalNote"] }))`.

## OAuth Configuration

Pass OAuth initialization options for the Swagger UI:

```typescript
docs = $swagger({
  info: { title: "My API", version: "1.0.0" },
  ui: {
    initOAuth: {
      clientId: "my-client-id",
      appName: "My App",
      usePkceWithAuthorizationCodeGrant: true,
    },
  },
});
```
