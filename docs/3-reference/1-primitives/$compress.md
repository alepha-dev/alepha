# $compress

## Import

```typescript
import { $compress } from "alepha/server/compress";
```

## Overview

* Disable compression for this route.
   */
  disabled?: boolean;
}

/**
Middleware that configures response compression per-route.

Sets per-request compression options in the ALS context.
The global `ServerCompressProvider.onResponse` hook reads these
and applies them instead of the defaults.

Use `disabled: true` to skip compression entirely (e.g. binary downloads).
Use `allowedContentTypes` to override which content types get compressed.

**Route middleware** — works inside `$action`.

```typescript
class DownloadController {
  getFile = $action({
    use: [$compress({ disabled: true })],
    handler: async ({ params }) => { ... },
  });
}
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `disabled` | `boolean` | No | Disable compression for this route. |

