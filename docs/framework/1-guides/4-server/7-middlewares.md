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

### Build Metadata

`GET /version` is part of `AlephaServer` too, and answers a different question from `/health`: not "can this take traffic" but "what is running here".

```json
{
  "name": "lore",
  "version": "0.27.1",
  "commit": "6faea71",
  "build": {
    "date": "2026-08-31T09:14:22.000Z",
    "runtime": "workerd",
    "dev": false
  },
  "framework": "0.27.1"
}
```

The same record is readable anywhere in your app as `alepha.meta`, in the browser as well as on the server - it is resolved once at build time and baked into both bundles, so a footer showing the build date cannot disagree with what the server reports.

```typescript
alepha.meta.version; // "0.27.1", or "latest" on an untagged commit
alepha.meta.commit; // "6faea71", absent when the build had no git
alepha.meta.build.date; // ISO, absent when no build produced this code
```

`version` is the git tag on the built commit (a leading `v` is stripped), falling back to `"latest"`. Two absences carry information rather than being holes: no `commit` means there was no git at all, and no `build.date` means nothing built this code - a test run, a script, or the package imported outside a build.

Declare a version yourself when the tag is not the answer you want. An app that deploys on every push resolves to `"latest"` on everything that is not a release:

```typescript
// alepha.config.ts
export default defineConfig({
  meta: { version: pkg.version },
});
```

⚠️ In CI, the default `actions/checkout` fetches shallow and passes `--no-tags`, so `version` reports `"latest"` unless the job that builds your deployed artifact sets `fetch-tags: true`. `commit` is unaffected - resolving it needs no tags - so even a `"latest"` build says exactly which commit is running.

Configure the route with `versionOptions`. `expose` trims the payload, most usefully to publish a version while withholding the commit; `enabled: false` makes the path answer 404 without touching `/health`:

```typescript
import { versionOptions } from "alepha/server";

alepha.set(versionOptions, { expose: ["name", "version"] });
```

`path` is the one option that must be seeded at construction rather than written afterwards, because routes are registered before a later write would land:

```typescript
Alepha.create({ "alepha.server.version.options": { path: "/_version" } });
```

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

### ETag and Conditional Responses

`AlephaServerEtag` adds the `$etag` middleware, which hashes a response, sends
it as an `ETag`, and answers `304 Not Modified` when the client sends the same
value back in `If-None-Match`.

```typescript check
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

class Articles {
  get = $action({
    path: "/articles/:id",
    use: [$etag()],
    handler: async () => "an article",
  });
}
```

Bare `$etag()` only validates: the handler still runs on every request, and the
saving is bandwidth, not work. Pass `true` to also **store** the response, which
short-circuits the handler on a hit:

| Written as                         | Handler runs on a hit | Response body sent |
| ---------------------------------- | --------------------- | ------------------ |
| `$etag()`                          | yes                   | no (304)           |
| `$etag(true)`                      | no                    | no (304)           |
| `$etag({ store: [5, "minutes"] })` | no                    | no (304)           |

`control` sets `Cache-Control` on top of that, either as a literal string or as
directives:

```typescript check
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

class Stats {
  get = $action({
    path: "/stats",
    use: [
      $etag({
        store: { ttl: [5, "minutes"] },
        control: { public: true, maxAge: 300 },
      }),
    ],
    handler: async () => "stats",
  });
}
```

Stored responses are namespaced by caller identity, taken from the
`authorization` and `cookie` headers, so an authenticated route cannot serve one
user's body to another. Anonymous callers share a single entry. That is the
right default and it is also worth knowing before you put `store` on a route
whose response varies by something _other_ than those two headers, such as an
`Accept-Language` or a tenant header: those responses would share an entry.

### Path-Scoped Middleware

Everything above is either global (a module) or per-action (`use: [...]`).
`$middleware` is the level in between: middleware applied to every route under a
path prefix.

```typescript check
import { $secure } from "alepha/security";
import { $middleware } from "alepha/server";

class Gateway {
  api = $middleware({
    path: "/api",
    use: [$secure()],
  });
}
```

| Option    | Effect                                                     |
| --------- | ---------------------------------------------------------- |
| `path`    | Prefix to match. `/api` covers `/api/users`, `/api/orders` |
| `use`     | The middleware to apply                                    |
| `method`  | Restrict to one HTTP method, or a list                     |
| `exclude` | Route paths to leave alone                                 |

Use it for a cross-cutting concern that belongs to a whole path family, and keep
per-action `use` for behaviour that belongs to one action. The test is whether
you would have to remember to add it: a header every `/api` route must carry is a
`$middleware`, while a retry policy that suits one flaky upstream call is not.

`exclude` exists for the route inside the family that must not have it, such as a
health probe under a prefix that otherwise requires a token.

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
