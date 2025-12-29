# Alepha - Server

## Installation

```bash
npm install alepha
```

## Overview

Provides high-performance HTTP server capabilities with declarative routing and action primitives.

The server module enables building REST APIs and web applications using `$route` and `$action` primitives
on class properties. It provides automatic request/response handling, schema validation, middleware support,
and seamless integration with other Alepha modules for a complete backend solution.

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $action()

Creates a server action primitive for defining type-safe HTTP endpoints.

Server actions are the core building blocks for REST APIs in Alepha, providing declarative
HTTP endpoints with full type safety, automatic validation, and OpenAPI documentation.

**Key Features**
- Full TypeScript inference for request/response types
- Automatic schema validation using TypeBox
- Convention-based URL generation with customizable paths
- Direct invocation (`run()`) or HTTP requests (`fetch()`)
- Built-in authentication and authorization support
- Automatic content-type handling (JSON, form-data, plain text)

**URL Generation**

**Important:** All `$action` paths are automatically prefixed with `/api`.

```ts
$action({ path: "/users" })     // → GET /api/users
$action({ path: "/users/:id" }) // → GET /api/users/:id
$action({ path: "/hello" })     // → GET /api/hello
```

This prefix is configurable via the `SERVER_API_PREFIX` environment variable.
HTTP method defaults to GET, or POST if body schema is provided.

**Common Use Cases**
- CRUD operations with type safety
- File upload and download endpoints
- Microservice communication

```ts
class UserController {
  getUsers = $action({
    path: "/users",
    schema: {
      query: t.object({
        page: t.optional(t.number({ default: 1 })),
        limit: t.optional(t.number({ default: 10 }))
      }),
      response: t.object({
        users: t.array(t.object({
          id: t.text(),
          name: t.text(),
          email: t.text()
        })),
        total: t.number()
      })
    },
    handler: async ({ query }) => {
      const users = await this.userService.findUsers(query);
      return { users: users.items, total: users.total };
    }
  });

  createUser = $action({
    method: "POST",
    path: "/users",
    schema: {
      body: t.object({
        name: t.text(),
        email: t.text({ format: "email" })
      }),
      response: t.object({ id: t.text(), name: t.text() })
    },
    handler: async ({ body }) => {
      return await this.userService.create(body);
    }
  });
}
```

#### $route()

Create a basic endpoint.

It's a low level primitive. You probably want to use `$action` instead.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### ServerNotReadyProvider

On every request, this provider checks if the server is ready.

If the server is not ready, it responds with a 503 status code and a message indicating that the server is not ready yet.

The response also includes a `Retry-After` header indicating that the client should retry after 5 seconds.

#### ServerProvider

Base server provider to handle incoming requests and route them.

This is the default implementation for serverless environments.

ServerProvider supports both Node.js HTTP requests and Web (Fetch API) requests.

#### ServerRouterProvider

Main router for all routes on the server side.

- $route => generic route
- $action => action route (for API calls)
- $page => React route (for SSR)
