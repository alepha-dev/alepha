# Configurations

Alepha provides two primitives for configuration: `$env` for environment variables and `$atom` for runtime state.

## Environment Variables with $env

`$env` reads environment variables with schema validation, type coercion, and defaults. Import it from `"alepha"`.

```typescript check
import { $env, z } from "alepha";

class App {
  env = $env(z.object({
    DATABASE_URL: z.text(),
    PORT: z.integer().default(3000),
    DEBUG: z.boolean().optional(),
  }));

  connect() {
    console.log(this.env.DATABASE_URL); // string, guaranteed to exist
    console.log(this.env.PORT);         // number, defaults to 3000
    console.log(this.env.DEBUG);        // boolean | undefined
  }
}
```

The schema must be a `z.object(...)`. Each property maps to an environment variable name.
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

Values passed to `Alepha.create({ env })` take precedence over `process.env`. Variables from `.env` files loaded before the process starts (e.g. via `alepha dev`) are available automatically through `process.env`.

### Variable interpolation

String values support `$VAR` interpolation using other variables from the same schema:

```typescript
class Config {
  env = $env(z.object({
    HOST: z.text({ default: "localhost" }),
    PORT: z.integer().default(5432),
    DB_NAME: z.text({ default: "mydb" }),
    DATABASE_URL: z.text({ default: "postgres://$HOST:$PORT/$DB_NAME" }),
  }));
}
```

### Environment caching

Alepha caches parsed env results per schema. Multiple services using the same `z.object(...)` reference will share the same parsed output.

### Declassifying a variable that is not secret

**Every environment variable is treated as a secret.** That is already what
happens on deploy — every declared key is pushed to the target as an encrypted
binding — so there is nothing to do for a `DATABASE_URL` or an API key.

The annotation is the opt-out, for the handful of variables that genuinely are
not sensitive:

```typescript check
import { $env, z } from "alepha";

class Payments {
  env = $env(z.object({
    STRIPE_SECRET_KEY: z.text(),                  // secret, like everything else
    PUBLIC_URL: z.text({ secret: false }),        // declassified: safe in plaintext
  }));
}
```

`secret: true` is accepted and is the default, so writing it documents intent
without changing behaviour. `.meta({ secret: false })` is equivalent to the
option — `z.text({ ... })` forwards unknown options to `.meta()`.

The default runs this way round on purpose. The annotation is easy to forget,
and forgetting it must never be what exposes a value: a missed `secret: false`
costs you an unnecessarily encrypted log level, while a missed `secret: true`
under the opposite default would leak a key.

Two things read it today:

- **`alepha gen env`** labels the declassified variables in the generated
  template, so whoever fills it in can see at a glance which ones are safe to
  commit — everything unlabelled belongs in a secret store:

  ```
  # (public)
  #PUBLIC_URL=

  # Stripe API key
  #STRIPE_SECRET_KEY=
  ```

- **`alepha build`** records them as `publicVars` in `dist/manifest.json`,
  alongside the full `env` key list, for the deploy step to consume. Everything
  on `env` and not on `publicVars` is a secret.

## State Management with $atom

`$atom` defines a named, typed, validated piece of global state. Use it for application-level configuration and shared data.

### Defining an atom

```typescript check
import { $atom, z } from "alepha";

const appConfig = $atom({
  name: "app.config",
  schema: z.object({
    theme: z.enum(["light", "dark"]),
    language: z.text({ default: "en" }),
  }),
  default: { theme: "light", language: "en" },
});
```

The `name` uniquely identifies the atom in the state store. The `schema` defines the shape and validation. The `default` provides the initial value.

Recommended naming convention for `name` is dot-separated, e.g. `"app.config"`, `"user.settings"`, etc.

If the schema itself is optional (wrapped with `.optional()`, e.g. `z.object({...}).optional()`), the `default` is optional too. Otherwise — even when every field inside the object is optional — `default` is required.

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

### Reading atoms with $store

`$store` creates a reactive getter that always returns the current atom value:

```typescript
import { $atom, $store, z } from "alepha";

const count = $atom({
  name: "count",
  schema: z.object({ value: z.number() }),
  default: { value: 0 },
});

class Counter {
  count = $store(count);

  current() {
    return this.count.value; // always reads current state
  }
}
```

Under the hood, `$store` registers the atom and replaces the property with a getter that reads from the state store. When the state changes, the next property access returns the updated value:

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
