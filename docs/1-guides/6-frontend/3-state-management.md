# State Management

Alepha provides `$atom` for defining typed, validated state and `useStore` for consuming it in React components. State is a simple key-value store with schema validation, SSR hydration, and event-driven updates.

## Defining Atoms

Atoms are defined at the module level using `$atom`. Each atom has a unique name, a TypeBox schema, and an optional default value.

```typescript
import { $atom, t } from "alepha";

const counter = $atom({
  name: "app:counter",
  schema: t.object({
    count: t.integer(),
  }),
  default: { count: 0 },
});
```

Atoms must contain only serializable data. Avoid storing class instances, functions, or DOM elements.

**Options:**

| Option        | Type       | Description                                |
|---------------|------------|--------------------------------------------|
| `name`        | `string`   | Unique identifier for the atom.            |
| `schema`      | `TObject`  | TypeBox schema for validation.             |
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

## Non-React Access

Outside of React components, use `alepha.store` directly:

```typescript
// Read
const value = alepha.store.get(counter);

// Write
alepha.store.set(counter, { count: 42 });
```

Setting a value triggers the `state:mutate` event, which causes any `useStore` subscribers to re-render.

## SSR Hydration

Atoms participate in SSR automatically. On the server, state is serialized into the HTML response. On the client, the state is hydrated before React renders, so components see the server-set values on first render without flicker.

## Event System

State mutations emit a `state:mutate` event:

```typescript
alepha.events.on("state:mutate", ({ key, value }) => {
  console.log(`State changed: ${key}`, value);
});
```

This is how `useStore` knows when to re-render -- it listens for mutations matching its atom key.

## Example: Feature Flags

```typescript
import { $atom, t } from "alepha";
import { useStore } from "alepha/react";

const featureFlags = $atom({
  name: "app:features",
  schema: t.object({
    darkMode: t.boolean(),
    betaFeatures: t.boolean(),
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
