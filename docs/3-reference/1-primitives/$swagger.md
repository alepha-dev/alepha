# $swagger

## Import

```typescript
import { $swagger } from "alepha/server/swagger";
```

## Overview

Creates an OpenAPI/Swagger documentation primitive with interactive UI.

Automatically generates API documentation from your $action primitives and serves
an interactive Swagger UI for testing endpoints. Supports customization, tag filtering,
and OAuth configuration.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `info` | `OpenApiDocument["info"]` | No |  |
| `prefix` | `string` | No |  |
| `disabled` | `boolean` | No | If true, docs will be disabled. |
| `excludeTags` | `string[]` | No | Tags to exclude from the documentation. |
| `ui` | `boolean \| SwaggerUiOptions` | No | Enable Swagger UI. |
| `rewrite` | `Object` | No | Function to rewrite the OpenAPI document before serving it. |

## Examples

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

