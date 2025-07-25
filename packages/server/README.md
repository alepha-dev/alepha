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

## API Reference

### Descriptors

#### $action()

Create an action endpoint.

By default, all actions are prefixed by `/api`.
If `name` is not provided, the action will be named after the property key.
If `path` is not provided, the action will be named after the function name.

```ts
class MyController {
  hello = $action({
    handler: () => "Hello World",
  })
}
// GET /api/hello -> "Hello World"
```

#### $route()

Create a basic endpoint.

It's a low level descriptor. You probably want to use `$action` instead.

### Providers

#### ServerNotReadyProvider

On every request, this provider checks if the server is ready.

If the server is not ready, it responds with a 503 status code and a message indicating that the server is not ready yet.

The response also includes a `Retry-After` header indicating that the client should retry after 5 seconds.

#### ServerRouterProvider

Main router for all routes on the server side.

- $route => generic route
- $action => action route (for API calls)
- $page => React route (for SSR)
