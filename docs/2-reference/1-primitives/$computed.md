# $computed

## Import

```typescript
import { $computed } from "alepha";
```

## Overview

Define a derived, read-only value computed from one or more atoms
(or other computed values).

Dependencies are declared statically, which keeps the data flow explicit
and lets subscribers know exactly which mutations invalidate the value.

Computed values are never stored, serialized, hydrated, or persisted —
they are recomputed from their dependencies on every read, so they are
always correct inside request-scoped (fork) state on the server.

```ts
const cartTotal = $computed({
  name: "cartTotal",
  deps: [cartAtom],
  get: (cart) => cart.items.reduce((sum, it) => sum + it.price, 0),
});

alepha.store.get(cartTotal); // number
```

### Footgun: a `serverOnly` dependency breaks hydration

A computed whose deps include a `serverOnly` atom will NOT agree across the
SSR boundary. `serverOnly` keeps the atom out of the hydration payload, so
the server derives the value from the atom's real value while the browser
re-derives it from the atom's *default* — React then hydrates a DOM that
does not match the markup it received (a hydration mismatch, and a
silently wrong value afterwards).

Either keep the computed server-side only (read it via `alepha.store.get`,
never through `useComputed`), or derive it from atoms that ship to the
browser. Note this cuts the other way too: if the value is safe to send to
the browser, the dependency should not have been `serverOnly` to begin
with.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `N` | Yes |  |
| `deps` | `D` | Yes |  |
| `get` | `Object` | Yes |  |
| `description` | `string` | No |  |

