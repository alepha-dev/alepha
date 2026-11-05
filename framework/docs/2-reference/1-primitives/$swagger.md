# $swagger

## Import

```typescript
import { $swagger } from "alepha/server/swagger";
```

## Overview

Creates an OpenAPI documentation primitive.

Generates an OpenAPI 3 document from your $action primitives and serves it as
JSON at `<prefix>/json`. Supports customization and tag filtering. It serves no
viewer: point any OpenAPI viewer at the JSON route.

## Options

| Option        | Type                      | Required | Description                                                 |
| ------------- | ------------------------- | -------- | ----------------------------------------------------------- |
| `info`        | `OpenApiDocument["info"]` | No       |                                                             |
| `prefix`      | `string`                  | No       |                                                             |
| `disabled`    | `boolean`                 | No       | If true, docs will be disabled.                             |
| `excludeTags` | `string[]`                | No       | Tags to exclude from the documentation.                     |
| `servers`     | `OpenApiServer[]`         | No       | Server URLs for the API                                     |
| `rewrite`     | `Object`                  | No       | Function to rewrite the OpenAPI document before serving it. |

## Examples

```ts
class App {
  docs = $swagger({
    prefix: "/api-docs",
    info: {
      title: "My API",
      version: "1.0.0",
      description: "REST API documentation",
    },
    excludeTags: ["internal"],
    prefix: "/docs", // URL mount point (default)
  });
}
```
