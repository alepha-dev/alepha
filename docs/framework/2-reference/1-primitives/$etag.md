# $etag

## Import

```typescript
import { $etag } from "alepha/server/etag";
```

## Overview

Middleware that enables ETag-based response caching per-route.

Sets per-request etag options in the ALS context.
The global `ServerEtagProvider` hooks read these
to generate ETags, handle 304s, and optionally store responses.

When `store` is enabled, the middleware also checks the cache before
calling the handler, short-circuiting on cache hits.

**Route middleware** - works inside `$action`, `$page`, or any pipeline.

```typescript
class UserController {
  // ETag only (no response caching)
  getUser = $action({
    use: [$etag()],
    handler: async ({ params }) => { ... },
  });

  // ETag + response caching (store)
  getProfile = $action({
    use: [$etag(true)],
    handler: async ({ params }) => { ... },
  });

  // Fine-grained control
  getStats = $action({
    use: [$etag({ store: { ttl: [5, "minutes"] }, control: { public: true, maxAge: 300 } })],
    handler: async ({ params }) => { ... },
  });
}
```

Stored responses are namespaced by caller identity (the `authorization` and
`cookie` headers), so an authenticated route does not serve one user's body
to another. Anonymous callers share a single entry.

## Options

| Option  | Type                                            | Required | Description                                             |
| ------- | ----------------------------------------------- | -------- | ------------------------------------------------------- |
| `store` | `true \| DurationLike \| CachePrimitiveOptions` | No       | If true, enables storing cached responses               |
| `etag`  | `true`                                          | No       | If true, enables ETag support for the cached responses. |
