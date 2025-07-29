## Alepha Instance

```ts
import { Alepha } from "alepha";

const alepha = new Alepha();
```

The `Alepha` class is the core of the Alepha framework. It serves as the main entry point for your application, allowing you to configure and run your app.

### Factory

```ts
import { Alepha } from "@alepha/core";

const alepha = Alepha.create();
```

A preferred way to create an instance of Alepha is by using the `create` method.

- Server-side, it will use `process.env.*`.
- In testing environments, it will attach `.start` and `.stop` methods to `beforeAll` and `afterAll` hooks if globals is enabled.

### Lifecycle Methods

```ts
await alepha.start();
await alepha.stop();
```

The `start` method initializes the Alepha instance, setting up the necessary environment and configurations.
The `stop` method gracefully shuts down the instance, cleaning up resources and connections.

#### Running the Application

```ts
import { run } from "alepha";

run(alepha) // => alepha.start().then(() => process.on("exit", () => alepha.stop()));
```

The `run` function is a convenience method that starts the Alepha instance.
It abstracts away the details of server setup, allowing you to focus on building your application.
On the server side, `.stop` will be called automatically when the process exits, ensuring a clean shutdown.

### Configuration

```ts
import { Alepha } from "alepha";

Alepha.create({
  env: {
    // custom environment variables
    MY_VAR: "value",
  },
  // other configuration options
});
```

Alepha constructors can accept a configuration object that allows you to set custom environment variables and other options.
Env variables can be accessed using `alepha.env.MY_VAR`, it's immutable, so you cannot change it after the instance is created.

### Container

```ts
import { Alepha, run } from "alepha";
import { AlephaServer } from "alepha/server";

const alepha = Alepha.create();

alepha.with(AlephaServer); // register a http server

run(alepha); // run http server
```

The Alepha instance acts as a container for your application. You can register services, providers, modules, that your application needs.

> Descriptors will automatically register their module when they are used, so you don't need to register them manually. </br>
> Example: A service with `$route()` will register the `AlephaServer` for you.

You can also inject services.

```ts
import { Alepha, run } from "alepha";

class MyService {
  greet() {
    return "Hello from MyService!";
  }
}

const alepha = Alepha.create();
const myService = alepha.inject(MyService);

console.log(myService.greet()); // "Hello from MyService!"
```
