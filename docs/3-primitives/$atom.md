# $atom

> Define an atom for state management.

## Import

```typescript
import { $atom } from "alepha";
```

## Overview

Define an atom for state management.

Atom lets you define a piece of state with a name, schema, and default value.

By default, Alepha state is just a simple key-value store.
Using atoms allows you to have type safety, validation, and default values for your state.

You control how state is structured and validated.

Features:
- Set a schema for validation
- Set a default value for initial state
- Rules, like read-only, custom validation, etc.
- Automatic getter access in services with {@link $use}
- SSR support (server state automatically serialized and hydrated on client)
- React integration (useAtom hook for automatic component re-renders)
- Middleware
- Persistence adapters (localStorage, Redis, database, file system, cookie, etc.)
- State migrations (version upgrades when schema changes)
- Documentation generation & devtools integration

Common use cases:
- user preferences
- feature flags
- configuration options
- session data

Atom must contain only serializable data.
Avoid storing complex objects like class instances, functions, or DOM elements.
If you need to store complex data, consider using identifiers or references instead.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `N` | Yes |  |
| `schema` | `T` | Yes |  |
| `description` | `string` | No |  |

