# Middlewares

Alepha provides built-in middleware modules for common server needs.

## Built-in (AlephaServer)

The following are built into `AlephaServer` and active by default. Configure via atoms or disable globally.

### Compression

Response compression (gzip, brotli, zstd) based on the client's `Accept-Encoding` header. Active by default for JSON, HTML, JavaScript, CSS, and plain text responses.

Configure via the `compressOptions` atom:

```typescript
import { compressOptions } from "alepha/server";

alepha.store.mut(compressOptions, (old) => ({
  ...old,
  disabled: true, // disable compression entirely
}));
```

| Option                | Default                                                                                 | Description                            |
| --------------------- | --------------------------------------------------------------------------------------- | -------------------------------------- |
| `disabled`            | `false`                                                                                 | Disable compression entirely           |
| `allowedContentTypes` | `["application/json", "text/html", "application/javascript", "text/plain", "text/css"]` | Content types eligible for compression |

### Security Headers (Helmet)

HTTP security headers on every response. Active by default.

Configure via the `helmetOptions` atom:

```typescript
import { helmetOptions } from "alepha/server";

alepha.store.mut(helmetOptions, (old) => ({
  ...old,
  xFrameOptions: "DENY",
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.example.com"],
    },
  },
}));
```

| Option                    | Default                                         | Description                       |
| ------------------------- | ----------------------------------------------- | --------------------------------- |
| `disabled`                | `false`                                         | Disable security headers entirely |
| `isSecure`                | -                                               | Force secure context (HSTS)       |
| `strictTransportSecurity` | `{ maxAge: 15552000, includeSubDomains: true }` | HSTS configuration                |
| `xFrameOptions`           | `"SAMEORIGIN"`                                  | X-Frame-Options header            |
| `xXssProtection`          | `false`                                         | X-XSS-Protection header           |
| `referrerPolicy`          | `"strict-origin-when-cross-origin"`             | Referrer-Policy header            |
| `contentSecurityPolicy`   | -                                               | CSP directives                    |

`contentSecurityPolicy` has three states. Omit it and no CSP header is sent. Pass `{}` (no `directives`) to send the built-in policy: `'self'` for scripts, forms, frames and images, `'none'` for objects, plus `upgrade-insecure-requests`. Pass `{ directives: {} }` to send no CSP header while leaving every other security header in place - an empty directive map is not a permissive policy, so it is dropped rather than sent empty.

### Multipart

Multipart form-data parsing for file uploads. Runs for any route with a `body` schema when the request's content type is `multipart/form-data`, and handles `z.file()` and `z.stream()` parts.

Configure via the `multipartOptions` atom:

```typescript
import { multipartOptions } from "alepha/server";

alepha.store.mut(multipartOptions, (old) => ({
  ...old,
  limit: 50_000_000, // 50MB total
  fileLimit: 10_000_000, // 10MB per file
  fileCount: 20,
}));
```

| Option      | Default           | Description                                   |
| ----------- | ----------------- | --------------------------------------------- |
| `limit`     | `10000000` (10MB) | Maximum total multipart request size in bytes |
| `fileLimit` | `5000000` (5MB)   | Maximum single file size in bytes             |
| `fileCount` | `10`              | Maximum number of files per request           |

## Optional Modules

These are registered with `alepha.with()`.

### CORS

Cross-Origin Resource Sharing comes from the `AlephaServerCors` module. Register it and configure the `corsOptions` atom for global behavior:

```typescript check
import { Alepha } from "alepha";
import { AlephaServerCors, corsOptions } from "alepha/server/cors";

const alepha = Alepha.create().with(AlephaServerCors);
alepha.store.mut(corsOptions, (o) => ({
  ...o,
  origin: "https://app.example.com",
  credentials: true,
}));
```

For per-action CORS, attach the `$cors` middleware instead: `use: [$cors({ origin: "..." })]`.

| Option        | Default                                                | Description                                              |
| ------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `origin`      | `"*"`                                                  | Allowed origins. `"*"` for all, or comma-separated list. |
| `methods`     | `["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]` | Allowed HTTP methods                                     |
| `headers`     | `["Content-Type", "Authorization"]`                    | Allowed request headers                                  |
| `credentials` | `false`                                                | Allow credentials (cookies, auth headers)                |
| `maxAge`      | -                                                      | Preflight cache duration in seconds                      |

Alepha automatically creates an `OPTIONS` preflight route for every path when the CORS module is active - including `GET`-only paths, which browsers preflight as soon as the request carries a non-simple header such as `Authorization`.

Responses always carry `Vary: Origin`, since the allowed origin is reflected from the request.

**`credentials` requires an explicit origin.** With `origin: "*"` the allowed origin is reflected back, so pairing it with `credentials: true` would let _any_ site read authenticated responses - the exact thing the browser's own ban on `Access-Control-Allow-Origin: *` plus credentials prevents. Alepha refuses that combination: `Access-Control-Allow-Credentials` is omitted and a warning is logged at startup. List the origins you trust to enable credentials.

### Rate Limiting

Rate limiting comes from the `AlephaServerRateLimit` module. Register it and configure the `rateLimitOptions` atom for a global limit, or attach the `$rateLimit` middleware to individual actions:

```typescript check
import { $action } from "alepha/server";
import { $rateLimit } from "alepha/server/rate-limit";

class App {
  login = $action({
    use: [$rateLimit({ max: 100, windowMs: 15 * 60 * 1000 })],
    handler: async () => "ok",
  });
}
```

| Option                   | Default           | Description                                             |
| ------------------------ | ----------------- | ------------------------------------------------------- |
| `max`                    | `100`             | Maximum requests per window                             |
| `windowMs`               | `900000` (15 min) | Window duration in milliseconds                         |
| `keyGenerator`           | -                 | Custom function to generate rate limit keys per request |
| `skipFailedRequests`     | `false`           | Do not count failed requests                            |
| `skipSuccessfulRequests` | `false`           | Do not count successful requests                        |

#### Per-Action Rate Limiting

Apply rate limits directly on an action. The `rateLimit` route option is enforced by
`AlephaServerRateLimit` - it is not part of the base `AlephaServer`, so without the module
registered the option is silently ignored:

```typescript check
import { $action } from "alepha/server";
import { AlephaServerRateLimit } from "alepha/server/rate-limit";
import { Alepha } from "alepha";

class App {
  login = $action({
    method: "POST",
    path: "/auth/login",
    rateLimit: {
      max: 5,
      windowMs: 60 * 1000, // 5 attempts per minute
    },
    handler: async ({ body }) => {
      /* ... */
    },
  });
}

Alepha.create().with(AlephaServerRateLimit).with(App);
```

### Health Check

`GET /health` and `GET /healthz` are part of `AlephaServer` - every server has them, with nothing to import.

```json
{ "message": "OK", "uptime": 42, "date": "2026-07-31T17:26:36Z", "ready": true }
```

`ready` is the field that matters. It follows the container's lifecycle, so it is `false` for exactly as long as the app is still starting - which is longer than you might expect, because a process binds its port _before_ it runs its migrations.

That gap is why this is not opt-in. A supervisor or load balancer starting your app cannot ask it to expose a readiness endpoint; without one, the best it can do is open a TCP connection, which succeeds while the app is still building its database. It then sends traffic the app cannot serve. Alepha exposes `/health` universally so the caller can tell _listening_ from _working_.

Put your reverse proxy in front of it: `/health` describes your internals and belongs on loopback, not on the public host. [Bay](https://github.com/alepha-dev/alepha/tree/main/apps/bay) returns 404 for it on the public interface.

<!-- docs-check-ignore: migration note about a removed symbol -->

`AlephaServerHealth` has been removed - delete the import if you still have one; `/health` ships with `AlephaServer` itself.

### Metrics

`AlephaServerMetrics` exposes a Prometheus-compatible metrics endpoint. Import from `alepha/server/metrics`.

```typescript
import { Alepha } from "alepha";
import { AlephaServerMetrics } from "alepha/server/metrics";

Alepha.create().with(AlephaServerMetrics).with(App).start();
```

Serves metrics in Prometheus text format at `/metrics`.

Opt-in, unlike `/health`: it pulls in `prom-client`, and an app that nothing scrapes should not carry it.

Set `METRICS_TOKEN` if the app itself is reachable from the network. Alepha warns at startup when it is - production, no token, and `SERVER_HOST` bound to something other than loopback. An app on loopback behind a proxy gets no warning: the proxy decides what the internet sees.

## Combining Middlewares

Register multiple modules together:

```typescript check
import { Alepha } from "alepha";
import { AlephaServerCors, corsOptions } from "alepha/server/cors";
import {
  AlephaServerRateLimit,
  rateLimitOptions,
} from "alepha/server/rate-limit";

const alepha = Alepha.create()
  .with(AlephaServerCors)
  .with(AlephaServerRateLimit);

alepha.store.mut(corsOptions, (o) => ({
  ...o,
  origin: "https://app.example.com",
}));
alepha.store.mut(rateLimitOptions, (o) => ({
  ...o,
  max: 100,
  windowMs: 15 * 60 * 1000,
}));

await alepha.start();
```

Module order in `.with()` calls does not affect execution order. Alepha uses hook priorities internally to ensure correct ordering (e.g., CORS headers are set before the handler runs).
