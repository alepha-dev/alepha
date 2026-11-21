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

A request is answered `304 Not Modified` when its `If-None-Match` names
the response's ETag: a list of validators, a weak one (`W/"..."`) and `*`
all match. A stored response also carries `Last-Modified`, the time it was
stored, and answers `If-Modified-Since`.

When `store` is enabled, the middleware also checks the cache before
calling the handler, short-circuiting on cache hits.

**Route middleware** - works inside `$action`, `$page`, or any pipeline.

```typescript
class UserController {
  // ETag only (no response caching)
  getUser = $action({
    method: "GET",
    path: "/getUser",
    use: [$etag()],
    handler: async ({ params }) => { ... },
  });

  // ETag + response caching (store)
  getProfile = $action({
    method: "GET",
    path: "/getProfile",
    use: [$etag(true)],
    handler: async ({ params }) => { ... },
  });

  // Fine-grained control
  getStats = $action({
    method: "GET",
    path: "/getStats",
    use: [$etag({ store: { ttl: [5, "minutes"] }, control: { public: true, maxAge: 300 } })],
    handler: async ({ params }) => { ... },
  });
}
```

Stored responses are namespaced by caller identity (the `authorization` and
`cookie` headers), so an authenticated route does not serve one user's body
to another. Anonymous callers share a single entry.

## Options

| Option    | Type                                            | Required | Description                                                                                        |
| --------- | ----------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `store`   | `true \| DurationLike \| CachePrimitiveOptions` | No       | If true, stores the response and answers later requests from the store without running the handler |
| `etag`    | `true`                                          | No       | Always on: sending an ETag is what `$etag` is for, and the option accepts no other value.          |
| `control` | `true \| string \| EtagCacheControlOptions`     | No       | The `Cache-Control` header of a successful response                                                |
