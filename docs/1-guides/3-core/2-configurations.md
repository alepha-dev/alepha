# Configurations

Alepha provides two primitives for configuration: `$env` for environment variables and `$atom` for runtime state.

## Environment Variables with $env

`$env` reads environment variables with schema validation, type coercion, and defaults. Import it from `"alepha"`.

```typescript
import { $env, t } from "alepha";

class App {
  env = $env(t.object({
    DATABASE_URL: t.text(),
    PORT: t.integer({ default: 3000 }),
    DEBUG: t.optional(t.boolean()),
  }));

  connect() {
    console.log(this.env.DATABASE_URL); // string, guaranteed to exist
    console.log(this.env.PORT);         // number, defaults to 3000
    console.log(this.env.DEBUG);        // boolean | undefined
  }
}
```

The schema must be a `t.object(...)`. Each property maps to an environment variable name.
Alepha validates values at instantiation time and throws if required variables are missing.

### How env values are resolved

`Alepha.create()` merges `process.env` with any values passed in the `state.env` option:

```typescript
const alepha = Alepha.create({
  env: {
    DATABASE_URL: "postgres://localhost/mydb",
    PORT: "8080",
  },
});
```

Values from `process.env` take precedence. This means `.env` files loaded before the process starts (e.g. via `alepha dev`) are available automatically.

### Variable interpolation

String values support `$VAR` interpolation using other variables from the same schema:

```typescript
class Config {
  env = $env(t.object({
    HOST: t.text({ default: "localhost" }),
    PORT: t.integer({ default: 5432 }),
    DB_NAME: t.text({ default: "mydb" }),
    DATABASE_URL: t.text({ default: "postgres://$HOST:$PORT/$DB_NAME" }),
  }));
}
```

### Environment caching

Alepha caches parsed env results per schema. Multiple services using the same `t.object(...)` reference will share the same parsed output.

## State Management with $atom

`$atom` defines a named, typed, validated piece of global state. Use it for application-level configuration and shared data.

### Defining an atom

```typescript
import { $atom, t } from "alepha";

const appConfig = $atom({
  name: "app.config",
  schema: t.object({
    theme: t.enum(["light", "dark"]),
    language: t.text({ default: "en" }),
  }),
  default: { theme: "light", language: "en" },
});
```

The `name` uniquely identifies the atom in the state store. The `schema` defines the shape and validation. The `default` provides the initial value.

Recommended naming convention for `name` is dot-separated, e.g. `"app.config"`, `"user.settings"`, etc.

If the schema has all optional fields (via `t.optional`), the `default` is optional too. Otherwise, `default` is required.

### Reading and writing atoms

Use `alepha.store.get()` and `alepha.store.set()` (or `alepha.set()` as shorthand):

```typescript
const alepha = Alepha.create();

// Read
const config = alepha.store.get(appConfig);
console.log(config.theme); // "light"

// Write
alepha.store.set(appConfig, { theme: "dark", language: "fr" });

// Shorthand write on the container
alepha.set(appConfig, { theme: "dark", language: "fr" });
```

### Injecting atoms with $use

`$use` creates a reactive getter that always returns the current atom value:

```typescript
import { $atom, $use, t } from "alepha";

const count = $atom({
  name: "count",
  schema: t.object({ value: t.number() }),
  default: { value: 0 },
});

class Counter {
  count = $use(count);

  current() {
    return this.count.value; // always reads current state
  }
}
```

Under the hood, `$use` registers the atom and replaces the property with a getter that reads from the state store. When the state changes, the next property access returns the updated value:

```typescript
const alepha = Alepha.create();
const counter = alepha.inject(Counter);

console.log(counter.count.value); // 0

alepha.store.set(count, { value: 42 });
console.log(counter.count.value); // 42
```

### State mutation events

Every `store.set()` call emits a `"state:mutate"` event:

```typescript
alepha.events.on("state:mutate", ({ key, value, prevValue }) => {
  console.log(`State "${key}" changed from`, prevValue, "to", value);
});
```

> Atoms is not only about configuration !
> This powers SSR hydration, React integration, and devtools.
