# Alepha - Server Swagger

## Installation

```bash
npm install alepha
```

## Overview

Plugin for Alepha Server that provides Swagger documentation capabilities.
It generates OpenAPI v3 documentation for the server's endpoints ($action).
It also provides a Swagger UI for interactive API documentation.

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $swagger()

Creates an OpenAPI/Swagger documentation descriptor with interactive UI.

Automatically generates API documentation from your $action descriptors and serves
an interactive Swagger UI for testing endpoints. Supports customization, tag filtering,
and OAuth configuration.

```ts
class App {
  docs = $swagger({
    prefix: "/api-docs",
    info: {
      title: "My API",
      version: "1.0.0",
      description: "REST API documentation"
    },
    excludeTags: ["internal"],
    ui: { root: "/swagger" }
  });
}
```
