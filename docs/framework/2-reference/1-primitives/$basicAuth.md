# $basicAuth

## Import

```typescript
import { $basicAuth } from "alepha/security";
```

## Overview

Middleware that enforces HTTP Basic Authentication on the request.

Works with request context only (HTTP). Reads the `Authorization: Basic` header,
validates credentials using timing-safe comparison, and throws 401 if invalid.

```typescript
class DevToolsController {
  dashboard = $action({
    use: [$basicAuth({ username: "admin", password: "secret" })],
    handler: async () => { ... },
  });
}
```

## Options

| Option     | Type     | Required | Description |
| ---------- | -------- | -------- | ----------- |
| `username` | `string` | Yes      |             |
| `password` | `string` | Yes      |             |
