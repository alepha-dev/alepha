# Alepha - Server Swagger

## Installation

Part of the `alepha` package. Import from `alepha/server/swagger`.

```bash
npm install alepha
```

## Overview

Automatic API documentation generation.

**Features:**

- Swagger/OpenAPI configuration
- Route: `GET /docs/json` (the OpenAPI document) - prefix configurable via `$swagger({ prefix })`
- No viewer: point any OpenAPI viewer at the JSON route

## API Reference

### Primitives

- [`$swagger`](/docs/reference-primitives-$swagger) - Creates an OpenAPI documentation primitive.
