# $cors

> Declares CORS configuration for specific server routes.

## Import

```typescript
import { $cors } from "alepha/server/cors";
```

## Overview

Declares CORS configuration for specific server routes.
This primitive provides path-based CORS configuration.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | Name identifier for this CORS config (default: property key). |
| `paths` | `string[]` | No | Path patterns to match (supports wildcards like /api/*). |

## Examples

```ts
class ApiService {
  // Apply specific CORS to API routes
  cors = $cors({
    paths: ["/api/*"],
    origin: "https://app.example.com",
    credentials: true,
  });
}
```

