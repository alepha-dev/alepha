# $action

## Import

```typescript
import { $action } from "alepha/server";
```

## Overview

Creates a server action primitive for defining type-safe HTTP endpoints.

Server actions are the core building blocks for REST APIs in Alepha, providing declarative
HTTP endpoints with full type safety, automatic validation, and OpenAPI documentation.

**Key Features**

- Full TypeScript inference for request/response types
- Automatic schema validation using Zod
- An explicit method and path on every action, no convention to remember
- Direct invocation (`run()`) or HTTP requests (`fetch()`)
- Built-in authentication and authorization support
- Automatic content-type handling (JSON, form-data, plain text)

**URL Generation**

**Important:** All `$action` paths are automatically prefixed with `/api`.

```ts
$action({ method: "GET", path: "/users" }); // → GET /api/users
$action({ method: "GET", path: "/users/:id" }); // → GET /api/users/:id
$action({ method: "POST", path: "/hello" }); // → POST /api/hello
```

This prefix is configurable via the `serverApiOptions` atom
(`alepha.store.mut(serverApiOptions, (o) => ({ ...o, prefix: "/v1" }))`).
`method` and `path` are both required: a read declares `method: "GET"`, and
renaming the property never moves the URL.

**Common Use Cases**

- CRUD operations with type safety
- File upload and download endpoints
- Microservice communication

## Options

| Option        | Type                                       | Required | Description                                                                                               |
| ------------- | ------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| `name`        | `string`                                   | No       | Name of the action                                                                                        |
| `group`       | `string`                                   | No       | Group actions together                                                                                    |
| `path`        | `string`                                   | Yes      | Pathname of the route, below the API prefix (`/api` by default)                                           |
| `method`      | `RouteMethod`                              | Yes      | The route method                                                                                          |
| `schema`      | `TConfig`                                  | No       | The config schema of the route                                                                            |
| `description` | `string`                                   | No       | A short description of the action                                                                         |
| `disabled`    | `boolean`                                  | No       | Disable the route                                                                                         |
| `use`         | `TUse`                                     | No       | Middlewares wrapping the handler, outermost first                                                         |
| `errors`      | `TErrors`                                  | No       | The errors this action answers with: `$error` constants or built-in `HttpError` classes (`NotFoundError`) |
| `handler`     | `ServerActionHandler&lt;TConfig, TUse&gt;` | Yes      | Main route handler                                                                                        |

## Examples

```ts
class UserController {
  getUsers = $action({
    method: "GET",
    path: "/users",
    schema: {
      query: z.object({
        page: z.number().default(1).optional(),
        limit: z.number().default(10).optional(),
      }),
      response: z.object({
        users: z.array(
          z.object({
            id: z.text(),
            name: z.text(),
            email: z.text(),
          }),
        ),
        total: z.number(),
      }),
    },
    handler: async ({ query }) => {
      const users = await this.userService.findUsers(query);
      return { users: users.items, total: users.total };
    },
  });

  createUser = $action({
    method: "POST",
    path: "/users",
    schema: {
      body: z.object({
        name: z.text(),
        email: z.text({ format: "email" }),
      }),
      response: z.object({ id: z.text(), name: z.text() }),
    },
    handler: async ({ body }) => {
      return await this.userService.create(body);
    },
  });
}
```
