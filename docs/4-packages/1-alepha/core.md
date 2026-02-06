# Alepha - Core

Easy-to-use modern TypeScript framework for building many kind of applications.

## Installation

Part of the `alepha` package. Import from `alepha`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.1.0 | node, bun, workerd, browser, expo|

Foundation of the entire framework with dependency injection and lifecycle management.

**Features:**
- Dependency injection for services
- Service substitution/mocking
- Type-safe environment variable loading with TypeBox schemas
- Lifecycle hooks (start, stop, log, etc.)
- Module definitions and composition
- Request-scoped context access via Async Local Storage (ALS)
- Reactive state management with atoms
- Cluster mode with automatic worker forking
- Full TypeScript generics and type inference

## API Reference

### Primitives

- [`$atom`](/docs/primitives-$atom) — Define an atom for state management.
- [`$env`](/docs/primitives-$env) — Get typed values from environment variables.
- [`$hook`](/docs/primitives-$hook) — Registers a new hook.
- [`$inject`](/docs/primitives-$inject) — Get the instance of the specified type from the context.
- [`$module`](/docs/primitives-$module) — Wrap Services and Primitives into a Module.
- [`$use`](/docs/primitives-$use) — Subscribes to an atom's state and returns its current value for use in components.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### CodecManager

CodecManager manages multiple codec formats and provides a unified interface
for encoding and decoding data with different formats.

#### Json

Mimics the JSON global object with stringify and parse methods.

Used across the codebase via dependency injection.

#### KeylessJsonSchemaCodec

KeylessJsonSchemaCodec provides schema-driven JSON encoding without keys.

It uses the schema to determine field order, allowing the encoded output
to be a simple JSON array instead of an object with keys.
