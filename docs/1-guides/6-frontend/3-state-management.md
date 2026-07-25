# State Management

Alepha provides `$atom` for defining typed, validated state and `useStore` for consuming it in React components. State is a simple key-value store with schema validation, SSR hydration, and event-driven updates.

## Defining Atoms

Atoms are defined at the module level using `$atom`. Each atom has a unique name, a Zod schema, and an optional default value.

```typescript
import { $atom, z } from "alepha";

const counter = $atom({
  name: "app:counter",
  schema: z.object({
    count: z.number().int(),
  }),
  default: { count: 0 },
});
```

Atoms must contain only serializable data. Avoid storing class instances, functions, or DOM elements.

**Options:**

| Option        | Type       | Description                                |
|---------------|------------|--------------------------------------------|
| `name`        | `string`   | Unique identifier for the atom.            |
| `schema`      | `ZodType`  | Zod schema for validation.                 |
| `default`     | `Static<T>` | Default value. Required unless schema is fully optional. |
| `description` | `string`   | Optional description for documentation.    |

## useStore Hook

The `useStore` hook connects React components to Alepha state. It returns a `[value, setValue]` tuple, similar to `useState`.

```typescript
import { useStore } from "alepha/react";

function Counter() {
  const [state, setState] = useStore(counter);

  return (
    <button onClick={() => setState({ count: state.count + 1 })}>
      Count: {state.count}
    </button>
  );
}
```

When the state changes (from any source), the component re-renders automatically.

### Using with Atom

```typescript
const [value, setValue] = useStore(counter);
```

### Using with Store Keys

You can also access state by string key, without an atom:

```typescript
const [lang, setLang] = useStore("alepha.react.i18n.lang");
```

This is used internally by Alepha modules (e.g., i18n, router) for framework-level state.

### Default Values

Pass a default value as the second argument. It is applied only if the current value is `null` or `undefined`:

```typescript
const [prefs, setPrefs] = useStore(userPrefs, { theme: "light" });
```

## Selecting Slices with useSelector

`useStore` re-renders whenever *any* part of the atom mutates, even fields the component never reads. For an atom with several independent fields, that means unrelated updates trigger renders you don't need. `useSelector` subscribes to a derived slice instead, and only re-renders when that slice actually changes.

```typescript
import { $atom, z } from "alepha";
import { useSelector } from "alepha/react";

const prefs = $atom({
  name: "app:prefs",
  schema: z.object({
    theme: z.string(),
    sidebar: z.object({ collapsed: z.boolean() }),
  }),
  default: { theme: "light", sidebar: { collapsed: false } },
});

function ThemeLabel() {
  const theme = useSelector(prefs, (s) => s.theme);
  return <span>{theme}</span>;
}
```

`ThemeLabel` only re-renders when `theme` changes. Toggling `sidebar.collapsed` elsewhere in the app leaves it alone -- `useStore(prefs)` would re-render on both.

By default, the selected value is compared with `Object.is`. If your selector builds a new object or array on every call, `Object.is` never considers two calls equal, so the component would re-render on every mutation regardless of whether the slice actually changed. Pass `shallowEqual` as the third argument to compare the result key by key instead:

```typescript
import { useSelector, shallowEqual } from "alepha/react";

function Sidebar() {
  const sidebar = useSelector(
    prefs,
    (s) => ({ collapsed: s.sidebar.collapsed }),
    shallowEqual,
  );
  // ...
}
```

**When to use which:**

- `useStore(atom)` returns `[value, setValue]` -- use it when a component reads *and* writes the whole atom, or genuinely needs every field.
- `useSelector(atom, select, equality?)` is read-only and re-renders only on changes to the selected slice -- use it for components that only care about part of a larger, frequently-changing atom. To write, call `alepha.store.set(atom, ...)` or use `useStore` elsewhere in the tree.

## Non-React Access

Outside of React components, use `alepha.store` directly:

```typescript
// Read
const value = alepha.store.get(counter);

// Write
alepha.store.set(counter, { count: 42 });
```

Setting a value triggers the `state:mutate` event, which causes any `useStore` subscribers to re-render.

## Validation

Atom writes are validated against the schema you declared. An invalid write throws immediately, and unknown keys are silently stripped from the value that gets stored:

```typescript
const settings = $atom({
  name: "app:settings",
  schema: z.object({ theme: z.string(), count: z.number() }),
  default: { theme: "light", count: 0 },
});

alepha.store.set(settings, { theme: "dark", count: "nope" } as any);
// throws -- count must be a number

alepha.store.set(settings, { theme: "dark", count: 1, extra: true } as any);
alepha.store.get(settings); // { theme: "dark", count: 1 } -- `extra` is gone
```

This applies to every write path -- `useStore`'s setter, `alepha.store.set`, and raw string-key writes once the atom has registered.

Validation also runs the other direction, for a value that arrives from *outside* a normal `set` call: the SSR hydration payload, or a value passed to `Alepha.create(seed)`. If that value doesn't match the schema, the atom falls back to its declared default (and a warning is logged) instead of storing something invalid.

## SSR Hydration

Atoms participate in SSR automatically. On the server, state is serialized into the HTML response. On the client, the state is hydrated before React renders, so components see the server-set values on first render without flicker.

## Persistence

By default, atom state lives only in memory, for the lifetime of the process (server) or the page (browser). Add `persist` to keep a value around across requests, reloads, or tabs:

```typescript
const uiPrefs = $atom({
  name: "app:uiPrefs",
  schema: z.object({ theme: z.string() }),
  default: { theme: "light" },
  persist: "cookie",
});
```

| `persist` value  | Where it works        | Notes |
|------------------|------------------------|-------|
| `"cookie"`       | Server **and** browser | The only SSR-safe option: the server reads the cookie while rendering, so the very first paint already matches the persisted state. Use this for any app that renders on the server. |
| `"localStorage"` | Browser only           | Fine for pure SPAs. The server cannot see it; registering such an atom during SSR logs a warning. |
| `"sessionStorage"` | Browser only         | Same as `localStorage`, scoped to the tab. |

To make `persist: "cookie"` work, register the cookies module once, in code shared between your server and browser entry points:

```typescript
import { Alepha } from "alepha";
import { AlephaServerCookies } from "alepha/server/cookies";

const alepha = Alepha.create().with(AlephaServerCookies);
```

`alepha/server/cookies` resolves to the server adapter or the browser adapter automatically depending on the build target, so this single `.with(...)` call wires up both sides. `localStorage` and `sessionStorage` need no extra module -- they're wired up automatically per atom.

Corrupted or invalid stored values -- a hand-edited cookie, a schema that changed since the value was written, `localStorage` filled with garbage -- are discarded, and the atom's declared default is used instead. This happens silently; persistence never throws.

**Security:** `persist: "cookie"` atoms are unsigned, unencrypted, and can be overwritten by any client-side script or a hand-crafted request -- never persist trust-bearing state (user ids, roles, entitlements) in one. If you need a signed, encrypted, or `httpOnly` cookie, use the `$cookie` primitive directly instead of `persist`.

## Derived State with $computed

Some values aren't state on their own -- they're computed from other state. `$computed` defines a read-only value derived from one or more atoms (or other computed values), with a static list of dependencies:

```typescript
import { $atom, $computed, z } from "alepha";

const cart = $atom({
  name: "app:cart",
  schema: z.object({
    items: z.array(z.object({ price: z.number(), quantity: z.number() })),
  }),
  default: { items: [] },
});

const cartTotal = $computed({
  name: "app:cartTotal",
  deps: [cart],
  get: (state) =>
    state.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
});
```

`get` receives the current value of each entry in `deps`, in order, and returns the derived value. Read it like an atom, in a component with `useComputed`:

```typescript
import { useComputed } from "alepha/react";

function CartSummary() {
  const total = useComputed(cartTotal);
  return <p>Total: ${total.toFixed(2)}</p>;
}
```

or outside of React:

```typescript
alepha.store.get(cartTotal); // number
```

`deps` can mix atoms and other `Computed` values, as long as they don't form a cycle -- a computed that depends on itself, even transitively through another computed, throws an `AlephaError` instead of recursing forever.

Computed values are **read-only**: `alepha.store.set(cartTotal, ...)` throws. Change the atoms it depends on instead. They are also never stored, serialized into the SSR hydration payload, or persisted -- the value is recomputed from its dependencies on every read, which is what keeps it correct for request-scoped state on the server (each request/fork gets its own derived value, never a stale one cached from a different request).

Declare a `$computed` at module scope, next to the atoms it depends on, the same way you declare atoms. Constructing one inline inside a component body creates a new instance on every render, which forces `useComputed` to resubscribe unnecessarily.

## Event System

State mutations emit a `state:mutate` event:

```typescript
alepha.events.on("state:mutate", ({ key, value }) => {
  console.log(`State changed: ${key}`, value);
});
```

This is how `useStore` knows when to re-render -- it listens for mutations matching its atom key.

## Utilities

Beyond reading and writing, `alepha.store` exposes a few helpers for working with atoms outside of a component's render cycle.

**`reset(atom)`** restores the atom's declared default value. It's also exposed directly on the `alepha` instance:

```typescript
alepha.store.set(counter, { value: 99 });
alepha.reset(counter); // same as alepha.store.reset(counter)
alepha.store.get(counter); // { value: 0 }
```

**`watch(target, callback)`** subscribes to an atom, a `$computed` value, or a raw state key outside of React, and returns an unsubscribe function:

```typescript
const unsubscribe = alepha.store.watch(counter, (value, prevValue) => {
  console.log("counter changed", prevValue, "->", value);
});

// later
unsubscribe();
```

Watching a `$computed` works the same way -- the callback fires whenever any of its transitive dependencies mutate.

**`serverOnly: true`** excludes an atom from the SSR hydration payload, so its value never ships to the browser:

```typescript
const sessionSecret = $atom({
  name: "app:sessionSecret",
  schema: z.object({ token: z.string() }),
  default: { token: "" },
  serverOnly: true,
});
```

Use it for state that must never leave the server -- internal request-scoped data, secrets touched during rendering. The guarantee reaches further than just the hydration payload: `serverOnly` also withholds the value from the devtools mutation log and metadata endpoints, so it can't leak through those channels either.

`serverOnly` cannot be combined with `persist` -- every persistence adapter targets the browser by definition, so declaring both throws an `AlephaError` at `$atom()` call time. Pick one.

## Example: Feature Flags

```typescript
import { $atom, z } from "alepha";
import { useStore } from "alepha/react";

const featureFlags = $atom({
  name: "app:features",
  schema: z.object({
    darkMode: z.boolean(),
    betaFeatures: z.boolean(),
  }),
  default: {
    darkMode: false,
    betaFeatures: false,
  },
});

function FeatureToggle() {
  const [flags, setFlags] = useStore(featureFlags);

  return (
    <label>
      <input
        type="checkbox"
        checked={flags.darkMode}
        onChange={() => setFlags({ ...flags, darkMode: !flags.darkMode })}
      />
      Dark Mode
    </label>
  );
}
```
