# Middlewares

Alepha provides built-in middleware modules for common server needs.
Each module is registered with `alepha.with()` and configures itself automatically.

## CORS

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

### Options

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

## Rate Limiting

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

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `max` | `100` | Maximum requests per window |
| `windowMs` | `900000` (15 min) | Window duration in milliseconds |
| `paths` | - | Path patterns to apply to |
| `keyGenerator` | - | Custom function to generate rate limit keys per request |
| `skipFailedRequests` | `false` | Do not count failed requests |
| `skipSuccessfulRequests` | `false` | Do not count successful requests |

### Per-Action Rate Limiting

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

### Manual Rate Limit Checks

Use the `check()` method for custom rate limiting logic:

```typescript
class App {
  apiLimit = $rateLimit({ max: 10, windowMs: 60_000 });

  customAction = $action({
    handler: async (request) => {
      const result = await this.apiLimit.check(request);
      if (!result.allowed) {
        throw new HttpError({ status: 429, message: "Rate limited" });
      }
      return "ok";
    },
  });
}
```

## Helmet

`AlephaServerHelmet` sets security HTTP headers on every response. Import from `alepha/server/helmet`.

```typescript
import { Alepha } from "alepha";
import { AlephaServerHelmet } from "alepha/server/helmet";

Alepha.create()
  .with(AlephaServerHelmet)
  .with(App)
  .start();
```

Headers set include:
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Content-Security-Policy`
- Other standard security headers

## Health Check

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

## Compression

`AlephaServerCompress` compresses responses with gzip or brotli based on the client's `Accept-Encoding` header. Import from `alepha/server/compress`.

```typescript
import { Alepha } from "alepha";
import { AlephaServerCompress } from "alepha/server/compress";

Alepha.create()
  .with(AlephaServerCompress)
  .with(App)
  .start();
```

Supported runtimes: Node.js and Bun.

## Metrics

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
import { AlephaServerHelmet } from "alepha/server/helmet";
import { AlephaServerHealth } from "alepha/server/health";
import { AlephaServerCompress } from "alepha/server/compress";

class App {
  cors = $cors({ origin: "https://app.example.com" });
  limit = $rateLimit({ max: 100, windowMs: 15 * 60 * 1000 });
}

Alepha.create()
  .with(AlephaServerHelmet)
  .with(AlephaServerHealth)
  .with(AlephaServerCompress)
  .with(App)
  .start();
```

Module order in `.with()` calls does not affect execution order. Alepha uses hook priorities internally to ensure correct ordering (e.g., CORS headers are set before the handler runs).
