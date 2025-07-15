# Alepha Server

Core HTTP server for creating REST APIs.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server
```
## Module

Provides high-performance HTTP server capabilities with declarative routing and action descriptors.

The server module enables building REST APIs and web applications using `$route` and `$action` descriptors
on class properties. It provides automatic request/response handling, schema validation, middleware support,
and seamless integration with other Alepha modules for a complete backend solution.

**Key Features:**
- Declarative route definition with `$route` descriptor
- API action handlers with `$action` descriptor
- Schema validation for requests and responses
- Automatic body parsing and response formatting
- Built-in middleware system and error handling
- Type-safe request parameters and response data
- Integration with authentication and security modules

**Basic Routing:**
```ts
import { Alepha, run, t } from "alepha";
import { AlephaServer, $route } from "alepha/server";

class ApiRoutes {
  // Simple GET route
  getUsers = $route({
    path: "/api/users",
    method: "GET",
    handler: async () => {
      const users = await getAllUsers();
      return Response.json(users);
    },
  });

  // POST route with body validation
  createUser = $route({
    path: "/api/users",
    method: "POST",
    schema: {
      body: t.object({
        name: t.string(),
        email: t.string(),
      }),
    },
    handler: async ({ body }) => {
      const user = await createUser(body);
      return Response.json(user, { status: 201 });
    },
  });

  // Dynamic route with parameters
  getUserById = $route({
    path: "/api/users/:id",
    method: "GET",
    schema: {
      params: t.object({
        id: t.string(),
      }),
    },
    handler: async ({ params }) => {
      const user = await findUserById(params.id);
      if (!user) {
        return new Response("User not found", { status: 404 });
      }
      return Response.json(user);
    },
  });
}

const alepha = Alepha.create()
  .with(AlephaServer)
  .with(ApiRoutes);

run(alepha);
```

**Action Descriptors:**
```ts
import { $action } from "alepha/server";

class UserController {
  // Reusable business logic action
  getUserProfile = $action({
    schema: {
      params: t.object({
        userId: t.string(),
      }),
      response: t.object({
        id: t.string(),
        name: t.string(),
        email: t.string(),
      }),
    },
    handler: async ({ params }) => {
      const user = await getUserById(params.userId);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
      };
    },
  });

  // Route that uses the action
  profileRoute = $route({
    path: "/api/profile/:userId",
    method: "GET",
    handler: async ({ params }) => {
      const profile = await this.getUserProfile({ params });
      return Response.json(profile);
    },
  });
}
```

**Middleware and Error Handling:**
```ts
class AppServer {
  // Global middleware
  middleware = $route({
    path: "*",
    method: "*",
    handler: async ({ request, next }) => {
      console.log(`${request.method} ${request.url}`);
      try {
        return await next();
      } catch (error) {
        console.error("Request failed:", error);
        return Response.json({ error: "Internal Server Error" }, { status: 500 });
      }
    },
  });

  // CORS preflight handling
  corsPrelight = $route({
    path: "*",
    method: "OPTIONS",
    handler: async () => {
      return new Response(null, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    },
  });
}
```

## API Reference

### Providers

#### ServerRouterProvider

Main router for all routes on the server side.

- $route => generic route
- $action => action route (for API calls)
- $page => React route (for SSR)
