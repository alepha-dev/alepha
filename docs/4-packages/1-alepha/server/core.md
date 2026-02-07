# Alepha - Server

## Installation

Part of the `alepha` package. Import from `alepha/server`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.1.0 | node, bun, workerd|

Convention-driven HTTP server with automatic validation and type inference.

**Features:**
- Type-safe API endpoints with schema validation
- Lower-level HTTP route definitions
- Automatic request/response validation via TypeBox
- Convention-based URL generation (`/api/{ActionName}`)
- Direct invocation (`run()`) or HTTP (`fetch()`)
- Built-in authentication integration
- Multipart file upload handling
- Content-type auto-negotiation (JSON, form-data, text)
- HTTP methods: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
- Error handling: BadRequestError, ValidationError, ForbiddenError, UnauthorizedError, ConflictError, NotFoundError

## API Reference

### Primitives

- [`$action`](/docs/reference-primitives-$action) — Creates a server action primitive for defining type-safe HTTP endpoints.
- [`$route`](/docs/reference-primitives-$route) — Create a basic endpoint.

### Providers

- [`ServerNotReadyProvider`](/docs/reference-providers-servernotreadyprovider) — On every request, this provider checks if the server is ready.
- [`ServerProvider`](/docs/reference-providers-serverprovider) — Base server provider to handle incoming requests and route them.
- [`ServerRouterProvider`](/docs/reference-providers-serverrouterprovider) — Main router for all routes server side.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SERVER_API_PREFIX` | text | /api | Prefix for all API routes (e.g. $action). |
| `SERVER_BODY_PARSER_INFLATE` | boolean | true | Enable decompression of request body. |
| `SERVER_BODY_PARSER_LIMIT` | integer | 100_000 | Maximum size of request body in bytes. |
| `SERVER_HOST` | text | localhost | Set 0.0.0.0 to listen on all interfaces. |
| `SERVER_PORT` | integer | 3000 | Set 0 to listen on a random port. |
| `TRUST_PROXY` | boolean | true | Trust proxy headers for client IP |
