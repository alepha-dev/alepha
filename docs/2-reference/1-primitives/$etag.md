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

**Route middleware** — works inside `$action`, `$page`, or any pipeline.

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

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `store` | `true \| DurationLike \| CachePrimitiveOptions` | No | If true, enables storing cached responses |
| `etag` | `true` | No | If true, enables ETag support for the cached responses. |
| `public` | `boolean` | No | Indicates that the response may be cached by any cache. |
| `private` | `boolean` | No | Indicates that the response is intended for a single user and must not be stored by a shared cache. |
| `noCache` | `boolean` | No | Forces caches to submit the request to the origin server for validation before releasing a cached copy. |
| `noStore` | `boolean` | No | Instructs caches not to store the response. |
| `maxAge` | `number \| DurationLike` | No | Maximum amount of time a resource is considered fresh |
| `sMaxAge` | `number \| DurationLike` | No | Overrides max-age for shared caches (e.g., CDNs) |
| `mustRevalidate` | `boolean` | No | Indicates that once a resource becomes stale, caches must not use it without successful validation. |
| `proxyRevalidate` | `boolean` | No | Similar to must-revalidate, but only for shared caches. |
| `immutable` | `boolean` | No | Indicates that the response can be stored but must be revalidated before each use. |
| `staleWhileRevalidate` | `number \| DurationLike` | No | Time window (in seconds or DurationLike) during which a stale response may be served while a fresh one is fetched in the background |

