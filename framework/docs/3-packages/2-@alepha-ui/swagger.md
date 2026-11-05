# @alepha/ui - Swagger

## Installation

```bash
npm install @alepha/ui
```

## Overview

The API explorer.

`$uiSwagger` mounts a page that reads the app's OpenAPI document (served by
`$swagger` from `alepha/server/swagger`) and renders it with `@alepha/ui`:
operations by tag with a search, each in full with its schemas and the
`x-alepha-*` metadata Alepha adds. The components are exported too, for an
app that lays the explorer out itself.

## API Reference

### Primitives

- [`$uiSwagger`](/docs/reference-primitives-$uiswagger) - An API explorer page, reading the app's OpenAPI document.

### React Hooks

- [`useSwaggerAccess`](/docs/reference-react-hooks-useswaggeraccess) - Answers `SwaggerAccess` for each operation, against the current user.
