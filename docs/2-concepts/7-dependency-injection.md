# Dependency Injection (DI)

Alepha uses a Service Locator pattern wrapped in a strictly typed container.
If you come from Java (Spring) or Angular, this will feel familiar. If you come from Express, this might feel new.

## Why do we need this?

1.  **Testing:** You can swap a real database for an in-memory mock without changing your business logic code.
2.  **Singleton Management:** You don't want to open 50 connections to Redis. You want one connection shared across the app.
3.  **Organization:** It forces you to structure your code into logical units (Services) rather than a mess of loose functions.

## Injecting Services (`$inject`)

In Alepha, you don't use `constructor(private service: Service)`. You use `$inject`.

```typescript
import { $inject } from "alepha";
import { Database } from "./Database";

class UserService {
  // Alepha resolves this dependency lazily when the app starts
  db = $inject(Database);

  async get(id: string) {
    return this.db.users.findById(id);
  }
}
```

## Swapping Implementations

Let's say you have an `EmailProvider`.

```typescript
export class EmailProvider {
  async send(to: string, body: string) {
    // Send via SMTP
  }
}
```

In development, you don't want to spam real emails. You want to log them to the console.

```typescript
export class ConsoleEmailProvider extends EmailProvider {
  async send(to: string, body: string) {
    console.log(`[EMAIL TO ${to}]: ${body}`);
  }
}
```

In your `main.ts`:

```typescript
const app = Alepha.create();

if (process.env.NODE_ENV === 'development') {
  // Magic!
  // Everywhere 'EmailProvider' is injected, 'ConsoleEmailProvider' will be used instead.
  app.with({
    provide: EmailProvider,
    use: ConsoleEmailProvider
  });
}

run(app);
```

## Lifecycle Hooks

Services in Alepha have a lifecycle. You can hook into it using `$hook`.

*   `configure`: Setup configuration, read env vars.
*   `start`: Connect to databases, open ports.
*   `ready`: App is live, start cron jobs.
*   `stop`: Graceful shutdown, close connections.

```typescript
class Database {
  onStart = $hook({
    on: "start",
    handler: async () => {
      console.log("Connecting to DB...");
      await this.client.connect();
    }
  });

  onStop = $hook({
    on: "stop",
    handler: async () => {
      await this.client.close();
    }
  });
}
```

You don't call these manually. `run(alepha)` handles the orchestration for you.
