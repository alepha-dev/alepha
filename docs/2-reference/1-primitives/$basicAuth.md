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

**An empty password is refused when the middleware is declared**, with an
`AlephaError`. It would admit anyone who sends the username with no
password, and the usual way to get one is an unset variable read as
`password: this.env.SECRET ?? ""`: the gate then fails open, silently,
exactly when its configuration is missing. Refusing at declaration makes
that app fail to start instead.

## Options

| Option     | Type     | Required | Description                          |
| ---------- | -------- | -------- | ------------------------------------ |
| `username` | `string` | Yes      |                                      |
| `password` | `string` | Yes      | Must not be empty: see `$basicAuth`. |
