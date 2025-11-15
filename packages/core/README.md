# Alepha Core

The essential dependency injection and application lifecycle engine.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Core container of the Alepha framework.

It is responsible for managing the lifecycle of services,
handling dependency injection,
and providing a unified interface for the application.

```ts
import { Alepha, run } from "alepha";

class MyService {
  // business logic here
}

const alepha = Alepha.create({
  // state, env, and other properties
})

alepha.with(MyService);

run(alepha); // trigger .start (and .stop) automatically
```

### Alepha Factory

Alepha.create() is an enhanced version of new Alepha().
- It merges `process.env` with the provided state.env when available.
- It populates the test hooks for Vitest or Jest environments when available.

new Alepha() is fine if you don't need these helpers.

### Platforms & Environments

Alepha is designed to work in various environments:
- **Browser**: Runs in the browser, using the global `window` object.
- **Serverless**: Runs in serverless environments like Vercel or Vite.
- **Test**: Runs in test environments like Jest or Vitest.
- **Production**: Runs in production environments, typically with NODE_ENV set to "production".
* You can check the current environment using the following methods:

- `isBrowser()`: Returns true if the App is running in a browser environment.
- `isServerless()`: Returns true if the App is running in a serverless environment.
- `isTest()`: Returns true if the App is running in a test environment.
- `isProduction()`: Returns true if the App is running in a production environment.

### State & Environment

The state of the Alepha container is stored in the `store` property.
Most important property is `store.env`, which contains the environment variables.

```ts
const alepha = Alepha.create({ env: { MY_VAR: "value" } });

// You can access the environment variables using alepha.env
console.log(alepha.env.MY_VAR); // "value"

// But you should use $env() descriptor to get typed values from the environment.
class App {
  env = $env(
    t.object({
 	   MY_VAR: t.text(),
    })
  );
}
```

### Modules

Modules are a way to group services together.
You can register a module using the `$module` descriptor.

```ts
import { $module } from "alepha";

class MyLib {}

const myModule = $module({
  name: "my.project.module",
  services: [MyLib],
});
```

Do not use modules for small applications.

### Hooks

Hooks are a way to run async functions from all registered providers/services.
You can register a hook using the `$hook` descriptor.

```ts
import { $hook } from "alepha";

class App {
	 log = $logger();
	 onCustomerHook = $hook({
			on: "my:custom:hook",
			handler: () => {
		 	  this.log?.info("App is being configured");
	 		},
	  });
	}

Alepha.create()
	 .with(App)
	 .start()
	 .then(alepha => alepha.events.emit("my:custom:hook"));
```

	Hooks are fully typed. You can create your own hooks by using module augmentation:

	```ts
	declare module "alepha" {
		interface Hooks {
		  "my:custom:hook": {
				arg1: string;
		  }
		}
	}
	```

	@module alepha

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

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
Some modules also use hooks to run their own logic. (e.g. `@alepha/server`).

You can create your own hooks by using module augmentation:

```ts
declare module "@alepha/core" {

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

Wrap Services and Descriptors into a Module.

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

For more details, see the [Providers documentation](/docs/providers).

#### CodecManager

The output encoding format:
  - 'string': Returns JSON string
  - 'binary': Returns Uint8Array (for protobuf, msgpack, etc.)
  
  @default "string"
  /
  as?: T;

  /**
  The encoder to use (e.g., 'json', 'protobuf', 'msgpack')
  
  @default "json"
  /
  encoder?: string;

  /**
  Validation options to apply before encoding.
  /
  validation?: ValidateOptions | false;
}

export type EncodeResult<
  T extends TSchema,
  E extends Encoding,
> = E extends "string"
  ? string
  : E extends "binary"
    ? Uint8Array
    : StaticEncode<T>;

export interface DecodeOptions {
  /**
  The encoder to use (e.g., 'json', 'protobuf', 'msgpack')
  
  @default "json"
  /
  encoder?: string;

  /**
  Validation options to apply before encoding.
  /
  validation?: ValidateOptions | false;
}

/**
CodecManager manages multiple codec formats and provides a unified interface
for encoding and decoding data with different formats.

#### Json

Mimics the JSON global object with stringify and parse methods.

Used across the codebase via dependency injection.
