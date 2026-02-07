# Building an API

Alepha provides type-safe HTTP endpoints through the `$action` primitive. Actions are class properties that define request schemas, response schemas, and handler logic in a single declaration.

## Quick Start

Scaffold a new API project:

```bash
alepha init --api
```

This generates a project in current directory with a server entry point, a sample controller, and TypeBox schemas.

## Defining Actions

Actions are defined as class properties using `$action`. Each action becomes an HTTP endpoint.

```typescript
import { t } from "alepha";
import { $action } from "alepha/server";

class ProductController {
  list = $action({
    path: "/products",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ default: 1 })),
        limit: t.optional(t.integer({ default: 10 })),
      }),
      // good practice is to move complex schemas to separate files (api/schemas/*) and import them
      response: t.array(t.object({
        id: t.uuid(),
        name: t.text(),
        price: t.number(),
      })),
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
      body: t.object({
        name: t.text(),
        price: t.number(),
      }),
      response: t.object({ id: t.uuid(), name: t.text(), price: t.number() }),
    },
    handler: async ({ body }) => {
      return await this.repo.create(body);
    },
  });
}
```

## URL Generation

`$action` is a specialized `$route` where all paths are prefixed with `/api` by default.

```typescript
$action({ path: "/users" })       // GET /api/users
$action({ path: "/users/:id" })   // GET /api/users/:id
```

The prefix is configurable via the `SERVER_API_PREFIX` environment variable:

```bash
SERVER_API_PREFIX=/v1  # now: GET /v1/users
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
    schema: { params: t.object({ id: t.uuid() }) },
    handler: async ({ params }) => { /* ... */ },
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
    params: t.object({ id: t.uuid() }),
    body: t.object({ name: t.text(), price: t.number() }),
    response: t.object({ id: t.uuid(), name: t.text(), price: t.number() }),
  },
  handler: async ({ params, body }) => {
    return await this.repo.update(params.id, body);
  },
});
```

Supported methods: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`.

## Schema Object

The `schema` option accepts up to five fields:

| Field | Purpose |
|-------|---------|
| `params` | Path parameters (e.g. `/products/:id`) |
| `query` | URL query parameters |
| `body` | Request body (JSON, text, or multipart) |
| `headers` | Required request headers |
| `response` | Response body shape |

All fields use TypeBox schemas via the `t` helper from `alepha`. The handler receives fully validated and typed request data.

## Groups

Actions in the same class share a group. The group defaults to the class name. Groups are used for OpenAPI tags and permission namespacing.

Override the group explicitly:

```typescript
class AdminController {
  group = "admin";

  listUsers = $action({
    group: this.group,
    handler: () => { /* ... */ },
  });

  deleteUser = $action({
    group: this.group,
    handler: () => { /* ... */ },
  });
}
```

## Disabling an Action

The `disabled` option prevents the route from being registered. Useful for feature flags:

```typescript
class App {
  env = $env(t.object({
    ENABLE_BETA: t.boolean({ default: false }),
  }));

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
// Force direct local call - runs the handler in-process
const result = await this.list.run({ query: { page: 1, limit: 10 } });

// Force HTTP call - sends an actual HTTP request to the server
const response = await this.list.fetch({ query: { page: 1, limit: 10 } });

// Auto (local-first) - calls handler directly if available, otherwise HTTP
const result = await this.list({ query: { page: 1, limit: 10 } });
```

> Calling controllers directly are not recommended for shared libraries. Use `$client` links instead, which work across process and network boundaries (see [HTTP Links](/docs/guides-server-http-links)).
