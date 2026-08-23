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
- Convention-based URL generation with customizable paths
- Direct invocation (`run()`) or HTTP requests (`fetch()`)
- Built-in authentication and authorization support
- Automatic content-type handling (JSON, form-data, plain text)

**URL Generation**

**Important:** All `$action` paths are automatically prefixed with `/api`.

```ts
$action({ path: "/users" }); // → GET /api/users
$action({ path: "/users/:id" }); // → GET /api/users/:id
$action({ path: "/hello" }); // → GET /api/hello
```

This prefix is configurable via the `serverApiOptions` atom
(`alepha.store.mut(serverApiOptions, (o) => ({ ...o, prefix: "/v1" }))`).
HTTP method defaults to GET, or POST if body schema is provided.

**Common Use Cases**

- CRUD operations with type safety
- File upload and download endpoints
- Microservice communication

## Options

| Option        | Type                                 | Required | Description                       |
| ------------- | ------------------------------------ | -------- | --------------------------------- |
| `name`        | `string`                             | No       | Name of the action                |
| `group`       | `string`                             | No       | Group actions together            |
| `path`        | `string`                             | No       | Pathname of the route             |
| `method`      | `RouteMethod`                        | No       | The route method                  |
| `schema`      | `TConfig`                            | No       | The config schema of the route    |
| `description` | `string`                             | No       | A short description of the action |
| `disabled`    | `boolean`                            | No       | Disable the route                 |
| `handler`     | `ServerActionHandler&lt;TConfig&gt;` | Yes      | Main route handler                |

## Examples

```ts
class UserController {
  getUsers = $action({
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
