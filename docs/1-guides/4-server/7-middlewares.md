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
  disabled: true,  // disable compression entirely
}));
```

| Option | Default | Description |
|--------|---------|-------------|
| `disabled` | `false` | Disable compression entirely |
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

| Option | Default | Description |
|--------|---------|-------------|
| `disabled` | `false` | Disable security headers entirely |
| `isSecure` | - | Force secure context (HSTS) |
| `strictTransportSecurity` | `{ maxAge: 15552000, includeSubDomains: true }` | HSTS configuration |
| `xFrameOptions` | `"SAMEORIGIN"` | X-Frame-Options header |
| `xXssProtection` | `false` | X-XSS-Protection header |
| `referrerPolicy` | `"strict-origin-when-cross-origin"` | Referrer-Policy header |
| `contentSecurityPolicy` | - | CSP directives |

### Multipart

Multipart form-data parsing for file uploads. Active by default when a route schema includes `z.file()`.

Configure via the `multipartOptions` atom:

```typescript
import { multipartOptions } from "alepha/server";

alepha.store.mut(multipartOptions, (old) => ({
  ...old,
  limit: 50_000_000,      // 50MB total
  fileLimit: 10_000_000,  // 10MB per file
  fileCount: 20,
}));
```

| Option | Default | Description |
|--------|---------|-------------|
| `limit` | `10000000` (10MB) | Maximum total multipart request size in bytes |
| `fileLimit` | `5000000` (5MB) | Maximum single file size in bytes |
| `fileCount` | `10` | Maximum number of files per request |

## Optional Modules

These are registered with `alepha.with()`.

### CORS

The `$cors` primitive configures Cross-Origin Resource Sharing. Import from `alepha/server/cors`.

```typescript
import { $cors } from "alepha/server/cors";

class App {
  cors = $cors({
    origin: "https://app.example.com",
    credentials: true,
  });
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `origin` | `"*"` | Allowed origins. `"*"` for all, or comma-separated list. |
| `methods` | `["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]` | Allowed HTTP methods |
| `headers` | `["Content-Type", "Authorization"]` | Allowed request headers |
| `credentials` | `true` | Allow credentials (cookies, auth headers) |
| `maxAge` | - | Preflight cache duration in seconds |
| `paths` | - | Path patterns to match (e.g. `["/api/*"]`) |

When `paths` is provided, the CORS configuration applies only to matching routes. Without `paths`, it applies globally.

Alepha automatically creates `OPTIONS` preflight routes for all non-GET routes when the CORS module is active.

### Rate Limiting

The `$rateLimit` primitive limits request rates per client. Import from `alepha/server/rate-limit`.

```typescript
import { $rateLimit } from "alepha/server/rate-limit";

class App {
  limit = $rateLimit({
    max: 100,
    windowMs: 15 * 60 * 1000,  // 15 minutes
  });
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `max` | `100` | Maximum requests per window |
| `windowMs` | `900000` (15 min) | Window duration in milliseconds |
| `paths` | - | Path patterns to apply to |
| `keyGenerator` | - | Custom function to generate rate limit keys per request |
| `skipFailedRequests` | `false` | Do not count failed requests |
| `skipSuccessfulRequests` | `false` | Do not count successful requests |

#### Per-Action Rate Limiting

Apply rate limits directly on an action:

```typescript
import { $action } from "alepha/server";

class App {
  login = $action({
    method: "POST",
    path: "/auth/login",
    rateLimit: {
      max: 5,
      windowMs: 60 * 1000,  // 5 attempts per minute
    },
    handler: async ({ body }) => { /* ... */ },
  });
}
```

### Health Check

`AlephaServerHealth` adds a `GET /health` endpoint that returns `200 OK`. Import from `alepha/server/health`.

```typescript
import { Alepha } from "alepha";
import { AlephaServerHealth } from "alepha/server/health";

Alepha.create()
  .with(AlephaServerHealth)
  .with(App)
  .start();
```

Use this for load balancer health probes and container orchestration readiness checks.

### Metrics

`AlephaServerMetrics` exposes a Prometheus-compatible metrics endpoint. Import from `alepha/server/metrics`.

```typescript
import { Alepha } from "alepha";
import { AlephaServerMetrics } from "alepha/server/metrics";

Alepha.create()
  .with(AlephaServerMetrics)
  .with(App)
  .start();
```

Serves metrics in Prometheus text format at `/metrics`.

## Combining Middlewares

Register multiple modules together:

```typescript
import { Alepha } from "alepha";
import { $cors } from "alepha/server/cors";
import { $rateLimit } from "alepha/server/rate-limit";
import { AlephaServerHealth } from "alepha/server/health";

class App {
  cors = $cors({ origin: "https://app.example.com" });
  limit = $rateLimit({ max: 100, windowMs: 15 * 60 * 1000 });
}

Alepha.create()
  .with(AlephaServerHealth)
  .with(App)
  .start();
```

Module order in `.with()` calls does not affect execution order. Alepha uses hook priorities internally to ensure correct ordering (e.g., CORS headers are set before the handler runs).
