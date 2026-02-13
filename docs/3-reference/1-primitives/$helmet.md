# $helmet

## Import

```typescript
import { $helmet } from "alepha/server/helmet";
```

## Overview

Middleware that applies security headers with per-route overrides.

Builds headers using `ServerHelmetProvider.buildHeadersFor()` with the
provided overrides merged on top of global defaults, then sets them on
`request.reply`. The global `onResponse` hook's "don't overwrite" guard
skips headers that are already set.

**Route middleware** — requires a request context (`$action`). Throws if used outside one.

```typescript
class EmbedController {
  getWidget = $action({
    use: [$helmet({ xFrameOptions: undefined })],
    handler: async ({ query }) => { ... },
  });
}
```

