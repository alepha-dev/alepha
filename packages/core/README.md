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

> Some alepha methods are not intended to be used directly, use descriptors instead.
>
> - $hook -> alepha.on()
> - $inject -> alepha.get(), alepha.parseEnv()

## API Reference

### Descriptors

#### $cursor()

Get Alepha instance and Class definition from the current context.
This should be used inside a descriptor only.

```ts
import { $cursor } from "@alepha/core";

const $ = () => {

  const { context, definition } = $cursor();

  // context - alepha instance
  // definition - class which is creating this descriptor

  return {};
}

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
