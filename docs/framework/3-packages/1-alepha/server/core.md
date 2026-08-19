# Alepha - Server

## Installation

Part of the `alepha` package. Import from `alepha/server`.

```bash
npm install alepha
```

## Overview

Convention-driven HTTP server with automatic validation and type inference.

**Features:**
- Type-safe API endpoints with schema validation
- Lower-level HTTP route definitions
- Automatic request/response validation via Zod
- Convention-based URL generation (`/api/{ActionName}`)
- Direct invocation (`run()`) or HTTP (`fetch()`)
- Built-in authentication integration
- Multipart file upload handling
- Response compression (gzip, brotli, zstd)
- Security headers (HSTS, CSP, X-Frame-Options, etc.)
- Content-type auto-negotiation (JSON, form-data, text)
- HTTP methods: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
- Error handling: BadRequestError, ValidationError, ForbiddenError, UnauthorizedError, ConflictError, NotFoundError

## API Reference

### Primitives

- [`$action`](/docs/reference-primitives-$action) - Creates a server action primitive for defining type-safe HTTP endpoints.
- [`$circuit`](/docs/reference-primitives-$circuit) - Middleware that implements the circuit breaker pattern.
- [`$middleware`](/docs/reference-primitives-$middleware) - Applies middleware functions to every route whose path starts with a prefix.
- [`$route`](/docs/reference-primitives-$route) - Create a basic endpoint.
- [`$sse`](/docs/reference-primitives-$sse) - Creates a Server-Sent Events (SSE) primitive for streaming typed events to clients.

### Providers

- [`ServerHealthProvider`](/docs/reference-providers-serverhealthprovider) - Registers `GET /health` and `GET /healthz`.
- [`ServerHelmetProvider`](/docs/reference-providers-serverhelmetprovider) - Provides a configurable way to apply essential HTTP security headers
- [`ServerMultipartProvider`](/docs/reference-providers-servermultipartprovider) - Parses `multipart/form-data` request bodies into route handler input.
- [`ServerNotReadyProvider`](/docs/reference-providers-servernotreadyprovider) - On every request, this provider checks if the server is ready.
- [`ServerProvider`](/docs/reference-providers-serverprovider) - Base server provider to handle incoming requests and route them.
- [`ServerRouterProvider`](/docs/reference-providers-serverrouterprovider) - Main router for all routes server side.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SERVER_HOST` | text | localhost | Set 0.0.0.0 to listen on all interfaces. |
| `SERVER_PORT` | integer | 3000 | Set 0 to listen on a random port. |
| `TRUST_PROXY` | boolean | true | Trust proxy headers for client IP |
