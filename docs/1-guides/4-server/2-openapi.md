# OpenAPI Documentation

Alepha auto-generates OpenAPI 3.0 specifications from your `$action` definitions using the `$swagger` primitive.

## Setup

```typescript check
import { $swagger } from "alepha/server/swagger";

class App {
  docs = $swagger({
    info: {
      title: "My API",
      version: "1.0.0",
      description: "Product catalog REST API",
    },
  });
}
```

This serves:
- Interactive Swagger UI at `/docs`
- OpenAPI JSON at `/docs/json`

## Configuration

The `$swagger` primitive accepts these options:

| Option | Default | Description |
|--------|---------|-------------|
| `info` | `{ title: "API Documentation", version: "1.0.0" }` | OpenAPI info block |
| `prefix` | `"/docs"` | Base path for documentation endpoints |
| `disabled` | `false` | Disable documentation entirely |
| `excludeTags` | `[]` | Tag names to hide from documentation |
| `ui` | `true` | Enable/disable Swagger UI, or pass UI options |
| `rewrite` | - | Function to modify the generated OpenAPI document |

### Custom Prefix

```typescript
docs = $swagger({
  prefix: "/api-docs",
  info: { title: "My API", version: "2.0.0" },
});
// Swagger UI at /api-docs, JSON at /api-docs/json
```

### Excluding Tags

Tags correspond to action groups (class names by default). Hide internal endpoints:

```typescript
docs = $swagger({
  info: { title: "Public API", version: "1.0.0" },
  excludeTags: ["InternalController", "admin"],
});
```

### Rewriting the Document

Modify the generated OpenAPI document before it is served:

```typescript
docs = $swagger({
  info: { title: "My API", version: "1.0.0" },
  rewrite: (doc) => {
    doc.components ??= {};
    doc.components.securitySchemes = {
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    };
  },
});
```

## How Actions Map to OpenAPI

Each `$action` with a schema becomes an OpenAPI operation:

- **Operation ID** -- The action name (property key or explicit `name`).
- **Tag** -- The action group (class name or explicit `group`).
- **Summary/Description** -- From the `summary` and `description` options on `$action`.
- **Parameters** -- Generated from `schema.params` (path) and `schema.query` (query).
- **Request Body** -- Generated from `schema.body`. Objects become `application/json`, file schemas become `multipart/form-data`.
- **Response** -- Generated from `schema.response`.

Schema descriptions propagate to OpenAPI field descriptions:

```typescript
schema: {
  body: z.object({
    email: z.email().describe("User's email address"),
    age: z.integer().describe("User's age in years"),
  }),
}
```

## Security in OpenAPI

Actions that carry the `$secure` middleware (`use: [$secure(...)]`) are documented with a Bearer JWT security requirement; the `bearerAuth` scheme is emitted whenever at least one such action exists. Actions without `$secure` carry no security requirement.

## OAuth Configuration

Pass OAuth initialization options for the Swagger UI:

```typescript
docs = $swagger({
  info: { title: "My API", version: "1.0.0" },
  ui: {
    initOAuth: {
      clientId: "my-client-id",
      appName: "My App",
      usePkceWithAuthorizationCodeGrant: true,
    },
  },
});
```
