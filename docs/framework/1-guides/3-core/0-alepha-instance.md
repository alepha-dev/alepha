# The Alepha Instance

The `Alepha` class is the central container of your application. It holds configuration, manages state, controls lifecycle, and wires dependencies together.

Unlike tools that rely on global side-effects, Alepha keeps everything contained within this instance. This makes your application portable, testable, and predictable.

## Creating the Instance

Use the static factory method to initialize your app:

```typescript check
import { Alepha } from "alepha";

const alepha = Alepha.create();
```

`create()` automatically merges `process.env` with any custom configuration you provide. In test environments (Vitest with `globals: true`), it hooks into `beforeAll`, `afterAll`, `afterEach` and `onTestFinished` to manage the app lifecycle automatically - the latter two are what make per-test cleanup and failed-test log dumping work.

### Configuration

Pass a configuration object to `create`. The most important property is `env`:

```typescript
const alepha = Alepha.create({
  env: {
    APP_NAME: "My SaaS",
    // Secrets from process.env are merged automatically
  },
});

alepha.env.APP_NAME; // "My SaaS"
```

> **Typed Environment Variables**
>
> While `alepha.env` gives raw access, use the `$env` primitive inside services for type-safe, validated environment variables.

## Dependency Injection

Alepha is built on a dependency injection container. You register classes and Alepha wires them together.

### Registering Services (.with)

Use `.with()` to add services, modules, or providers:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServer } from "alepha/server";

const alepha = Alepha.create();
alepha.with(AlephaServer);
alepha.with(MyService);
```

> **Auto-Registration**
>
> You rarely need to register core modules manually. If you use a primitive like `$route` or `$repository` in your class, Alepha detects the dependency and registers the necessary modules for you.

### Injecting Services (.inject)

Access a service instance from outside a class (e.g., in a script or test):

```typescript
const myService = alepha.inject(MyService);
myService.doSomething();
```

`.inject(MyService)` is like `new MyService()` but with all dependencies automatically resolved.

### Swapping Implementations

Replace a service with a different implementation. This is the core of Alepha's testing and environment strategy:

```typescript
// In production: real emails via SMTP
// In development: log to console
alepha.with({
  provide: EmailProvider,
  use:
    process.env.NODE_ENV === "production"
      ? SmtpEmailProvider
      : ConsoleEmailProvider,
});
```

Any service that injects `EmailProvider` will receive the substituted implementation. Your business logic doesn't change.

### Service Lifetimes

| Lifetime    | Behavior                                             |
| ----------- | ---------------------------------------------------- |
| `singleton` | One instance per Alepha runtime (default)            |
| `transient` | New instance every time                              |
| `scoped`    | One instance per request context (AsyncLocalStorage) |

```typescript
alepha.inject(Logger, { lifetime: "transient" });
```

## Lifecycle

Alepha has a strict lifecycle to ensure resources are opened and closed correctly:

```txt
configure  →  start  →  ready  →  (running)  →  stop
```

| Phase       | What happens                                                    |
| ----------- | --------------------------------------------------------------- |
| `configure` | Services register configuration. Primitives read their schemas. |
| `start`     | Providers connect to I/O (database, HTTP server).               |
| `ready`     | App is live. Background jobs and schedulers start.              |
| `stop`      | Graceful shutdown. Connections close, buffers flush.            |

### Running the App

Use the `run` helper. It configures, starts, and handles SIGTERM/SIGINT for graceful shutdown:

```typescript
import { run } from "alepha";

run(alepha);
```

### Manual Control (Tests)

In tests, you often want manual lifecycle control:

```typescript
test("MyService", async () => {
  const app = Alepha.create().with(MyService);
  await app.start();

  const service = app.inject(MyService);
  expect(service.isReady).toBe(true);

  // await app.stop(); ← automatically called by Vitest hooks
});
```

## Providers

Providers separate infrastructure logic (the "how") from business logic (the "what"). A provider wraps external systems - databases, email services, storage - behind a clean API.

```typescript
import { $env, $hook, z } from "alepha";
import { $logger } from "alepha/logger";

export class EmailProvider {
  log = $logger();

  env = $env(
    z.object({
      SMTP_HOST: z.text(),
      SMTP_USER: z.text(),
      SMTP_PASS: z.text(),
    }),
  );

  protected transporter = createTransport({
    host: this.env.SMTP_HOST,
    auth: { user: this.env.SMTP_USER, pass: this.env.SMTP_PASS },
  });

  onStart = $hook({
    on: "start",
    handler: async () => {
      await this.transporter.verify();
      this.log.info("Connected to SMTP");
    },
  });

  async send(to: string, subject: string) {
    return this.transporter.sendMail({ from: "me@app.com", to, subject });
  }
}
```

Injecting a provider is no different from injecting any other service:

```typescript
class UserService {
  email = $inject(EmailProvider);

  register = $action({
    handler: async ({ body }) => {
      await this.email.send(body.email, "Welcome!");
    },
  });
}
```

### The Swap Strategy

Define an abstract provider, then swap implementations by environment:

```typescript
// Abstract contract
export abstract class QueueProvider {
  abstract push(job: object): Promise<void>;
}

// Production: Redis
export class RedisQueueProvider extends QueueProvider {
  async push(job: object) {
    /* redis logic */
  }
}

// Dev/Test: in-memory
export class MemoryQueueProvider extends QueueProvider {
  queue: object[] = [];
  async push(job: object) {
    this.queue.push(job);
  }
}
```

Wire it up:

```typescript
alepha.with({
  provide: QueueProvider,
  use: alepha.isProduction() ? RedisQueueProvider : MemoryQueueProvider,
});
```

Alepha ships with standard providers for common needs: file storage (`alepha/bucket`), job queues (`alepha/queue`), logging (`alepha/logger`), caching (`alepha/cache`), and more. Each has memory implementations for testing.
