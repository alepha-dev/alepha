# Alepha Server

Core HTTP server for creating REST APIs.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides high-performance HTTP server capabilities with declarative routing and action descriptors.

The server module enables building REST APIs and web applications using `$route` and `$action` descriptors
on class properties. It provides automatic request/response handling, schema validation, middleware support,
and seamless integration with other Alepha modules for a complete backend solution.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServer } from "alepha/server";

const alepha = Alepha.create()
	.with(AlephaServer);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $action()

Creates a server action descriptor for defining type-safe HTTP endpoints.

Server actions are the core building blocks for REST APIs in the Alepha framework. They provide
a declarative way to define HTTP endpoints with full TypeScript type safety, automatic schema
validation, and integrated security features. Actions automatically handle routing, request
parsing, response serialization, and OpenAPI documentation generation.

**Key Features**

- **Type Safety**: Full TypeScript inference for request/response types
- **Schema Validation**: Automatic validation using TypeBox schemas
- **Auto-routing**: Convention-based URL generation with customizable paths
- **Multiple Invocation**: Call directly (`run()`) or via HTTP (`fetch()`)
- **OpenAPI Integration**: Automatic documentation generation
- **Security Integration**: Built-in authentication and authorization support
- **Content Type Detection**: Automatic handling of JSON, form-data, and plain text

**URL Generation**

By default, actions are prefixed with `/api` (configurable via `SERVER_API_PREFIX`):
- Property name becomes the endpoint path
- Path parameters are automatically detected from schema
- HTTP method defaults to GET, or POST if body schema is provided

**Use Cases**

Perfect for building robust REST APIs:
- CRUD operations with full type safety
- File upload and download endpoints
- Real-time data processing APIs
- Integration with external services
- Microservice communication
- Admin and management interfaces

**Basic CRUD operations:**
```ts
import { $action } from "alepha/server";
import { t } from "alepha";

class UserController {

  getUsers = $action({
    path: "/users",
    description: "Retrieve all users with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.number({ default: 1 })),
        limit: t.optional(t.number({ default: 10, maximum: 100 })),
        search: t.optional(t.text())
      }),
      response: t.object({
        users: t.array(t.object({
          id: t.text(),
          name: t.text(),
          email: t.text(),
          createdAt: t.datetime()
        })),
        total: t.number(),
        hasMore: t.boolean()
      })
    },
    handler: async ({ query }) => {
      const { page, limit, search } = query;
      const users = await this.userService.findUsers({ page, limit, search });

      return {
        users: users.items,
        total: users.total,
        hasMore: (page * limit) < users.total
      };
    }
  });

  createUser = $action({
    method: "POST",
    path: "/users",
    description: "Create a new user account",
    schema: {
      body: t.object({
        name: t.text({ minLength: 2, maxLength: 100 }),
        email: t.text({ format: "email" }),
        password: t.text({ minLength: 8 }),
        role: t.optional(t.enum(["user", "admin"]))
      }),
      response: t.object({
        id: t.text(),
        name: t.text(),
        email: t.text(),
        role: t.text(),
        createdAt: t.datetime()
      })
    },
    handler: async ({ body }) => {
      // Password validation and hashing
      await this.authService.validatePassword(body.password);
      const hashedPassword = await this.authService.hashPassword(body.password);

      // Create user with default role
      const user = await this.userService.create({
        ...body,
        password: hashedPassword,
        role: body.role || "user"
      });

      // Return user without password
      const { password, ...publicUser } = user;
      return publicUser;
    }
  });

  getUser = $action({
    path: "/users/:id",
    description: "Retrieve user by ID",
    schema: {
      params: t.object({
        id: t.text()
      }),
      response: t.object({
        id: t.text(),
        name: t.text(),
        email: t.text(),
        role: t.text(),
        profile: t.optional(t.object({
          bio: t.text(),
          avatar: t.text({ format: "uri" }),
          location: t.text()
        }))
      })
    },
    handler: async ({ params }) => {
      const user = await this.userService.findById(params.id);
      if (!user) {
        throw new Error(`User not found: ${params.id}`);
      }
      return user;
    }
  });

  updateUser = $action({
    method: "PUT",
    path: "/users/:id",
    description: "Update user information",
    schema: {
      params: t.object({ id: t.text() }),
      body: t.object({
        name: t.optional(t.text({ minLength: 2 })),
        email: t.optional(t.text({ format: "email" })),
        profile: t.optional(t.object({
          bio: t.optional(t.text()),
          avatar: t.optional(t.text({ format: "uri" })),
          location: t.optional(t.text())
        }))
      }),
      response: t.object({
        id: t.text(),
        name: t.text(),
        email: t.text(),
        updatedAt: t.datetime()
      })
    },
    handler: async ({ params, body }) => {
      const updatedUser = await this.userService.update(params.id, body);
      return updatedUser;
    }
  });
}
```

**Important Notes**:
- Actions are automatically registered with the HTTP server when the service is initialized
- Use `run()` for direct invocation (testing, internal calls, or remote services)
- Use `fetch()` for explicit HTTP requests (client-side, external services)
- Schema validation occurs automatically for all requests and responses
- Path parameters are automatically extracted from schema definitions
- Content-Type headers are automatically set based on schema types

#### $route()

Create a basic endpoint.

It's a low level descriptor. You probably want to use `$action` instead.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### ServerNotReadyProvider

On every request, this provider checks if the server is ready.

If the server is not ready, it responds with a 503 status code and a message indicating that the server is not ready yet.

The response also includes a `Retry-After` header indicating that the client should retry after 5 seconds.

#### ServerRouterProvider

Main router for all routes on the server side.

- $route => generic route
- $action => action route (for API calls)
- $page => React route (for SSR)
