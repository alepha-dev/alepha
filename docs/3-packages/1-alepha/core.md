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

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $atom()

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

#### $env()

Get typed values from environment variables.

```ts
const alepha = Alepha.create({
  env: {
    // Alepha.create() will also use process.env when running on Node.js
    HELLO: "world",
  }
});

class App {
  log = $logger();

  // program expect a var env "HELLO" as string to works
  env = $env(t.object({
    HELLO: t.text()
  }));

  sayHello = () => this.log.info("Hello ${this.env.HELLO}")
}

run(alepha.with(App));
```

#### $hook()

Registers a new hook.

```ts
import { $hook } from "alepha";

class MyProvider {
  onStart = $hook({
    name: "start", // or "configure", "ready", "stop", ...
    handler: async (app) => {
      // await db.connect(); ...
    }
  });
}
```

Hooks are used to run async functions from all registered providers/services.

You can't register a hook after the App has started.

It's used under the hood by the `configure`, `start`, and `stop` methods.
Some modules also use hooks to run their own logic. (e.g. `alepha/server`).

You can create your own hooks by using module augmentation:

```ts
declare module "alepha" {

  interface Hooks {
    "my:custom:hook": {
      arg1: string;
    }
  }
}

await alepha.events.emit("my:custom:hook", { arg1: "value" });
```

#### $inject()

Get the instance of the specified type from the context.

```ts
class A { }
class B {
  a = $inject(A);
}
```

#### $module()

Wrap Services and Primitives into a Module.

- A module is just a Service with some extra {@link Module}.
- You must attach a `name` to it.
- Name must follow the pattern: `project.module.submodule`. (e.g. `myapp.users.auth`).

```ts
import { $module } from "alepha";
import { MyService } from "./MyService.ts";

// export MyService, so it can be used everywhere (optional)
export * from "./MyService.ts";

export default $module({
 name: "my.project.module",
 // MyService will have a module context "my.project.module"
 services: [MyService],
});
```

### Why Modules?

#### Logging

By default, AlephaLogger will log the module name in the logs.
This helps to identify where the logs are coming from.

You can also set different log levels for different modules.
It means you can set 'some.very.specific.module' to 'debug' and keep the rest of the application to 'info'.

#### Modulith

Force to structure your application in modules, even if it's a single deployable unit.
It helps to keep a clean architecture and avoid monolithic applications.

A strict mode flag will probably come to enforce module boundaries.
-> Throwing errors when a service from another module is injected.
But it's not implemented yet.

### When not to use Modules?

Small applications does not need modules. It's better to keep it simple.
Modules are more useful when the application grows and needs to be structured.
If we speak with number of `$actions`, a module should be used when you have more than 30 actions in a single module.
Meaning that if you have 100 actions, you should have at least 3 modules.

#### $use()

Subscribes to an atom's state and returns its current value for use in components.

Creates a reactive connection between an atom and a component, automatically registering
the atom in the application state if not already registered. The returned value is reactive
and will update when the atom's state changes.

**Use Cases**: Accessing global state, sharing data between components, reactive UI updates

```ts
const userState = $atom({ schema: t.object({ name: t.text(), role: t.text() }) });

class UserComponent {
  user = $use(userState); // Reactive reference to atom state

  render() {
    return <div>Hello {this.user.name}!</div>;
  }
}
```

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
