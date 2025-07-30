# Alepha Core

The essential dependency injection and application lifecycle engine.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core
```

## Module

Core container of the Alepha framework.

It is responsible for managing the lifecycle of services,
handling dependency injection,
and providing a unified interface for the application.

```ts
import { Alepha, run } from "@alepha/core";

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
 	   MY_VAR: t.string(),
    })
  );
}
```

### Modules

Modules are a way to group services together.
You can register a module using the `$module` descriptor.

```ts
import { $module } from "@alepha/core";

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
import { $hook } from "@alepha/core";

class App {
	 log = $logger();
	 onCustomerHook = $hook({
			on: "my:custom:hook",
			handler: () => {
		 	  this.log.info("App is being configured");
	 		},
	  });
	}

Alepha.create()
	 .with(App)
	 .start()
	 .then(alepha => alepha.emit("my:custom:hook"));
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

## API Reference

### Descriptors

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
    HELLO: t.string()
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

await alepha.emit("my:custom:hook", { arg1: "value" });
```

#### $inject()

Get the instance of the specified type from the context.

```ts
class A { }
class B {
  a = $inject(A);
}
```

#### $logger()

Create a logger.

`name` is optional, by default it will use the name of the service.

```ts
import { $logger } from "@alepha/core";

class MyService {
	log = $logger();

	constructor() {
	    // print something like 'date - [MyService] Service initialized'
		this.log.info("Service initialized");
	}
}
```

#### $module()

Wrap services and descriptors into a module.

Module is just a class.
You must attach a `name` to it.

It's recommended to use `project.module.submodule` format.

```ts
import { $module } from "@alepha/core";
import { MyService } from "./MyService.ts";

// export MyService so it can be used everywhere
export * from "./MyService.ts";

export default $module({
 name: "my.project.module",
 // MyService will have a module context "my.project.module"
 services: [MyService],
});
```

- Module is used for logging and other purposes.
- It's useful for large applications or libraries to group services and descriptors together.
- It's probably overkill for small applications.
