# Providers

If **Primitives** are the "superpowers" you attach to classes, **Providers** are the engines that power them.

In strict architectural terms, a **Service** contains your Business Logic (the "What"), and a **Provider** contains the Infrastructure Logic (the "How").

## The Separation of Concerns

When writing an application, you often need to talk to the outside world: sending emails, connecting to Redis, uploading files to S3.

You *could* put this logic directly inside your User Service, but that makes testing a nightmare. Instead, Alepha encourages you to wrap this infrastructure code into a **Provider**.

> At the end, providers are just a convention to make mocking and swapping implementations easier.

### Anatomy of a Provider

A Provider is just a class. However, it typically does three things:
1.  Validates its own configuration via `$env`.
2.  Manages its connection lifecycle via `$hook` (connect/disconnect).
3.  Exposes a clean API to the rest of the app.

Here is a production-ready Email Provider:

```ts
import { $env, $hook, t } from "alepha";
import { $logger } from "alepha/logger";
import { createTransport, type Transporter } from "my-super-mailer-lib";

export class EmailProvider {
  log = $logger();

  // 1. Configuration: The provider validates its own requirements
  env = $env(t.object({
    SMTP_HOST: t.text(),
    SMTP_USER: t.text(),
    SMTP_PASS: t.text(),
  }));

  transporter = createTransport({
    host: this.env.SMTP_HOST,
    auth: { user: this.env.SMTP_USER, pass: this.env.SMTP_PASS }
  });

  // 2. Lifecycle: Connect when the app starts
  onStart = $hook({
    on: "start",
    handler: async () => {
      await this.transporter.verify();
      this.log.info("Connected to SMTP");
    }
  });

  // 3. Public API: The rest of your app uses this
  async send(to: string, subject: string) {
    return this.transporter.sendMail({ from: "me@app.com", to, subject });
  }
}
```

### Using a Provider

Injecting a provider is no different than injecting a service. Use `$inject`.

```ts
import { $inject, $action } from "alepha";
import { EmailProvider } from "./EmailProvider";

class UserService {
  // Alepha injects the singleton instance of EmailProvider
  email = $inject(EmailProvider);

  register = $action({
    handler: async ({ body }) => {
      // ... logic to create user ...
      await this.email.send(body.email, "Welcome!");
    }
  });
}
```

## Polymorphism (The "Swap" Strategy)

This is where Alepha shines.

Sometimes, you want the "What" to stay the same, but the "How" to change depending on where the app is running.
*   **Local Dev:** You want to log emails to the console (free, fast).
*   **Production:** You want to send real emails via SendGrid/AWS SES.

You can achieve this using **Service Substitution**.

### 1. Define the Abstract Provider
This defines the "Contract". Your services will depend on this.

```ts
export abstract class QueueProvider {
  abstract push(job: object): Promise<void>;
}
```

### 2. Define Implementations
Different ways to fulfill the contract.

```ts
// For Production: Real Redis
export class RedisQueueProvider extends QueueProvider {
  async push(job: object) { /* ... redis logic ... */ }
}

// For Dev/Test: Just an array in memory
export class MemoryQueueProvider extends QueueProvider {
  queue: object[] = [];
  async push(job: object) { this.queue.push(job); }
}
```

### 3. Wire it up
In your entry point, you tell Alepha which implementation to use based on the environment.

```ts
import { Alepha, run } from "alepha";
import { QueueProvider, RedisQueueProvider, MemoryQueueProvider } from "./queue";

const alepha = Alepha.create();

// The Magic: Dependency Injection wiring
if (alepha.isProduction()) {
  // In Prod: When someone asks for 'QueueProvider', give them 'RedisQueueProvider'
  alepha.with({ provide: QueueProvider, use: RedisQueueProvider });
} else {
  // In Dev: When someone asks for 'QueueProvider', give them 'MemoryQueueProvider'
  alepha.with({ provide: QueueProvider, use: MemoryQueueProvider });
}

// Your app logic doesn't care. It just injects 'QueueProvider'.
run(alepha);
```

Voilà, now you are an Alepha EXPERT.

## Built-in Providers

Alepha provides standard implementations for common needs so you don't have to reinvent the wheel.

*   **`alepha/bucket`**: File storage. Switches between `LocalFileStorageProvider` (disk) and `S3`/`Azure` automatically.
*   **`alepha/queue`**: Job queues. Switches between `MemoryQueue` and `RedisQueue`.
*   **`alepha/logger`**: Logging. Switches between `Console` (pretty colors) and `JSON` (for log aggregators).

You focus on the logic; Alepha handles the plumbing.
