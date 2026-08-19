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
- Routes: `GET /docs` (UI), `GET /docs/json` (spec) - prefix configurable via `$swagger({ prefix })`

## API Reference

### Primitives

- [`$swagger`](/docs/reference-primitives-$swagger) - Creates an OpenAPI/Swagger documentation primitive with interactive UI.
