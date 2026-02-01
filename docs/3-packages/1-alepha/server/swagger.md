# Alepha - Server Swagger

## Installation

Part of the `alepha` package. Import from `alepha/server/swagger`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.9.0 | node, bun|

Automatic API documentation generation.

**Features:**
- Swagger/OpenAPI configuration
- Routes: `GET /swagger/ui`, `GET /swagger.json`

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $swagger()

Creates an OpenAPI/Swagger documentation primitive with interactive UI.

Automatically generates API documentation from your $action primitives and serves
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
