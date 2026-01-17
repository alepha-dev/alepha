# Alepha - Server Rate Limit

## Installation

Part of the `alepha` package. Import from `alepha/server/rate-limit`.

```bash
npm install alepha
```

## Overview

Provides rate limiting capabilities for server routes and actions with configurable limits and windows.

The server-rate-limit module enables per-route and per-action rate limiting using either:
- The `$rateLimit` primitive with `paths` option for path-based rate limiting
- The `rateLimit` option in action primitives for action-specific limiting

It offers sliding window rate limiting, custom key generation, and seamless integration with server routes.

```ts
import { $rateLimit, AlephaServerRateLimit } from "alepha/server/rate-limit";

class ApiService {
  // Path-specific rate limiting
  apiRateLimit = $rateLimit({
    paths: ["/api/*"],
    max: 100,
    windowMs: 15 * 60 * 1000, // 15 minutes
  });
}
```

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $rateLimit()

Declares rate limiting for server routes or custom usage.
This primitive provides methods to check rate limits and configure behavior
within the server request/response cycle.

```ts
class ApiService {
  // Apply rate limiting to specific paths
  apiRateLimit = $rateLimit({
    paths: ["/api/*"],
    max: 100,
    windowMs: 15 * 60 * 1000, // 15 minutes
  });

  // Or use check() method for manual rate limiting
  customAction = $action({
    handler: async (req) => {
      const result = await this.apiRateLimit.check(req);
      if (!result.allowed) throw new Error("Rate limited");
      return "ok";
    },
  });
}
```

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RATE_LIMIT_MAX_REQUESTS` | number | 100 | Maximum requests per window |
| `RATE_LIMIT_WINDOW_MS` | number | 15 * 60 * 1000 | Rate limit window in milliseconds |
