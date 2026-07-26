# $atom

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
- Schema validation on every write (invalid writes throw)
- Default value for initial state
- Automatic getter access in services with {@link $state}
- SSR support (server state automatically serialized and hydrated on client)
- React integration (useStore / useSelector hooks for automatic re-renders)
- Derived values with {@link $computed} (useComputed hook)
- Persistence adapters: cookie (SSR-safe), localStorage, sessionStorage
- `serverOnly` flag to keep an atom out of the hydration payload
- reset / watch helpers on the state manager
- Documentation generation & devtools integration (mutation log)

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
| `persist` | `AtomPersist` | No | Persist this atom outside the in-memory store |
| `serverOnly` | `boolean` | No | Keep this atom's *value* server-side |

