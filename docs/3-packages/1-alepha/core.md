# Alepha - Core

Easy-to-use modern TypeScript framework for building many kind of applications.

## Installation

Part of the `alepha` package. Import from `alepha`.

```bash
npm install alepha
```

## Overview

Foundation of the entire framework with dependency injection and lifecycle management.

**Features:**
- Dependency injection for services
- Service substitution/mocking
- Type-safe environment variable loading with Zod schemas
- Lifecycle hooks (start, stop, log, etc.)
- Module definitions and composition
- Request-scoped context access via Async Local Storage (ALS)
- Reactive state management with atoms
- Full TypeScript generics and type inference

## API Reference

### Primitives

- [`$atom`](/docs/reference-primitives-$atom) — Define an atom for state management.
- [`$computed`](/docs/reference-primitives-$computed) — Define a derived, read-only value computed from one or more atoms
- [`$env`](/docs/reference-primitives-$env) — Get typed values from environment variables.
- [`$hook`](/docs/reference-primitives-$hook) — Registers a new hook.
- [`$inject`](/docs/reference-primitives-$inject) — Get the instance of the specified type from the context.
- [`$memoize`](/docs/reference-primitives-$memoize) — Lightweight in-process memoization middleware.
- [`$mode`](/docs/reference-primitives-$mode) — Activate a selective bootstrap mode.
- [`$module`](/docs/reference-primitives-$module) — Wrap Services and Primitives into a Module.
- [`$pipeline`](/docs/reference-primitives-$pipeline) — Creates a pipeline primitive that composes middleware with a handler.
- [`$scope`](/docs/reference-primitives-$scope) — Middleware that wraps the handler in an ALS (AsyncLocalStorage) context.
- [`$state`](/docs/reference-primitives-$state) — Subscribes to an atom's state and returns its current value for use in components.

### Providers

- [`CodecManager`](/docs/reference-providers-codecmanager) — CodecManager manages multiple codec formats and provides a unified interface
- [`Json`](/docs/reference-providers-json) — Mimics the JSON global object with stringify and parse methods.
- [`KeylessJsonSchemaCodec`](/docs/reference-providers-keylessjsonschemacodec) — KeylessJsonSchemaCodec provides schema-driven JSON encoding without keys.
- [`SchemaValidator`](/docs/reference-providers-schemavalidator) — Validates + coerces a value against a zod schema.
