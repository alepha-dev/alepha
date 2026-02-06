# The Alepha Instance

The `Alepha` class is the brain of your application.
It acts as the central container that holds your configuration, manages the state, and controls the lifecycle of all your services.

Unlike tools that rely on global nasty side-effects, Alepha keeps everything contained within this instance.
This makes your application portable, testable, and predictable.

## Creating the Instance

While you *can* use `new Alepha()`, we strongly recommend using the static factory method.

```ts
import { Alepha } from "alepha";

// The standard way to initialize your app
const alepha = Alepha.create();
```

**Why `create()`?**
1.  **Environment Merging:** It automatically merges `process.env` (on the server) with any custom configuration you provide.
2.  **Test Integration:** If it detects a testing environment (like Vitest with `globals: true`), it automatically hooks into `beforeAll` and `afterAll` to manage the app lifecycle during tests.

### Configuration & Environment

You can pass a configuration object to `create`. The most important property is `env`.

```ts
const alepha = Alepha.create({
  env: {
    // 1. Set defaults or overrides
    APP_NAME: "My SaaS",

    // 2. Secrets are automatically loaded from process.env
    // You don't need to manually pass them here if they exist in the environment
  }
});

// Access anywhere via the instance (read-only)
console.log(alepha.env.APP_NAME);
```

> **Tip:** While `alepha.env` gives you raw access, we recommend using the [`$env`](/docs/packages-alepha-core#$env) primitive inside your services for type-safe, validated environment variables.

## The Container (Dependency Injection)

Alepha is built on a powerful Dependency Injection (DI) container. You don't manually instantiate your classes; you register them, and Alepha wires them together.

### Registering Services (`.with`)

Use `.with()` to add services, modules, or providers to your application.

```ts
import { Alepha, run } from "alepha";
import { AlephaServer } from "alepha/server";
import { MyDatabaseService } from "./services/db";

const alepha = Alepha.create();

// Register the HTTP Server module
alepha.with(AlephaServer);

// Register your own service
alepha.with(MyDatabaseService);
```

> **Auto-Registration Magic:**
> You rarely need to manually register core modules. If you use a primitive like `$route` or `$repository` in your class, Alepha automatically detects the dependency and registers the necessary modules (like `AlephaServer` or `AlephaPostgres`) for you.

### Using Services (`.inject`)

If you need to access a service from the outside (e.g., in a script or test), use `.inject()`.

```ts
const myService = alepha.inject(MyService);
myService.doSomething();
```

Technically, `.inject(MyService)` is nearly like `new MyService()` but with all dependencies automatically resolved and injected.

## Lifecycle Management

Alepha has a strict lifecycle to ensure resources (databases, ports, queues) are opened and closed correctly.

### The Phases

1.  **Configure:** All services register their configurations. Primitives like `$action` read their schemas.
2.  **Start:** Providers connect to IO (Database connections open, HTTP server listens).
3.  **Ready:** The app is live. Background jobs and schedulers start running.
4.  **Stop:** Graceful shutdown. HTTP server stops accepting requests, DB connections close.

```
CONFIGURE --> START --> READY --> (LIVE) --> STOP
```

### Running the App

You don't need to call the lifecycle methods manually. Use the `run` helper.

```ts
import { run } from "alepha";

// 1. Configures
// 2. Starts
// 3. Handles SIGTERM/SIGINT for graceful shutdown
run(alepha);
```

### Manual Control (For Tests)

In tests, you often want manual control over the lifecycle to mock services or test specific states.

```ts
// In a test file
test("MyService", async () => {
  const app = Alepha.create().with(MyService);

  await app.start(); // Connects to DB, etc.

  const service = app.inject(MyService);
  expect(service.isReady).toBe(true);

  // await app.stop(); <- automatically called by Vitest hooks
});
```
