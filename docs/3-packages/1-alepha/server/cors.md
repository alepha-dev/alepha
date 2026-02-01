# Alepha - Server Cors

## Installation

Part of the `alepha` package. Import from `alepha/server/cors`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.3.0 | node, bun, workerd|

Cross-Origin Resource Sharing configuration.

**Features:**
- CORS policy definition

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $cors()

Declares CORS configuration for specific server routes.
This primitive provides path-based CORS configuration.

```ts
class ApiService {
  // Apply specific CORS to API routes
  cors = $cors({
    paths: ["/api/*"],
    origin: "https://app.example.com",
    credentials: true,
  });
}
```
