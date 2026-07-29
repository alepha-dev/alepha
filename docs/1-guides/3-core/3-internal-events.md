# Internal Events

Alepha uses a hook-based event system for lifecycle management and cross-service communication.

## Confusion Warning

- `$hook` is not a React Hook (e.g. `useState`). It is an event listener.
- `$hook` is not a pub/sub system. Use `$topic` for pub/sub.

## Lifecycle

When `alepha.start()` is called, the framework emits events in this order:

```
configure  ->  start  ->  ready  ->  (APP RUNNING)  ->  stop
```

| Hook | When | Typical use |
|------|------|-------------|
| `configure` | Before start, after container is locked | Register providers, resolve configuration |
| `start` | After configure | Connect to databases, start listeners |
| `ready` | After start | Application is fully operational |
| `stop` | On shutdown (SIGINT/SIGTERM or manual) | Close connections, flush buffers |

`configure`, `start`, and `ready` receive the `Alepha` instance as payload. `stop` also receives the `Alepha` instance.

## Using $hook

Register hooks with the `$hook` primitive. It must be a class property.

```typescript
import { $hook } from "alepha";
import { $logger } from "alepha/logger";

class DatabaseService {
  log = $logger();

  onStart = $hook({
    on: "start",
    handler: async () => {
      await this.connectToDatabase();
      this.log.info("Database connected");
    },
  });

  onStop = $hook({
    on: "stop",
    handler: async () => {
      await this.disconnectFromDatabase();
      this.log.info("Database disconnected");
    },
  });
}
```

### Hook options

```typescript
$hook({
  on: "start",           // required: event name
  handler: async () => { /* ... */ },  // required: callback
  priority: "first",     // optional: "first" | "last" (default: insertion order)
});
```

`priority: "first"` places the hook at the front of the execution queue. `priority: "last"` places it at the end. Without a priority, hooks execute in registration order (which follows dependency order). For finer ordering relative to specific services, `before` and `after` accept a service class (or an array of them) that this hook must run before or after.

### Hook call tracking

Each `$hook` instance tracks how many times it has been called:

```typescript
const alepha = Alepha.create().with(App);
await alepha.start();

const app = alepha.inject(App);
console.log(app.onStart.called); // 1
```

> This is useful for testing to ensure hooks are called the expected number of times.

## Built-in Hooks

The core `Hooks` interface defines:

```typescript
interface Hooks {
  configure: Alepha;                 // configuration phase
  start: Alepha;                     // start phase
  ready: Alepha;                     // ready phase
  stop: Alepha;                      // shutdown phase
  "state:mutate": {                  // state change notification
    key: keyof State;
    value: any;
    prevValue: any;
  };
  "state:register": { atom: Atom };  // an atom was registered
  echo: unknown;                     // free-form event for testing/debugging
}
```

Other modules extend this interface. For example, `alepha/logger` adds `log`, `alepha/server` adds server-related hooks, and so on.

## Custom Hooks

Define custom hooks using TypeScript module augmentation:

```typescript
declare module "alepha" {
  interface Hooks {
    "billing:invoice:created": {
      invoiceId: string;
      amount: number;
    };
  }
}
```

### Listening to custom hooks

As a class property with `$hook`:

```typescript
class NotificationService {
  onInvoice = $hook({
    on: "billing:invoice:created",
    handler: async ({ invoiceId, amount }) => {
      await this.sendReceipt(invoiceId, amount);
    },
  });
}
```

Or directly on the event manager:

```typescript
alepha.events.on("billing:invoice:created", ({ invoiceId, amount }) => {
  console.log(`Invoice ${invoiceId} created for ${amount}`);
});
```

`alepha.events.on()` returns an unsubscribe function:

```typescript
const unsubscribe = alepha.events.on("billing:invoice:created", handler);
// later...
unsubscribe();
```

### Emitting custom hooks

```typescript
await alepha.events.emit("billing:invoice:created", {
  invoiceId: "inv_123",
  amount: 99.99,
});
```

The `emit` method accepts options:

```typescript
await alepha.events.emit("billing:invoice:created", payload, {
  log: true,   // log execution timing of each hook
  catch: true, // catch errors and log them instead of throwing
});
```

## Compiled Events (advanced)

For hot paths (like HTTP request handling), compile events into optimized executors:

```typescript
// After all hooks are registered (e.g. after start)
const onRequest = alepha.events.compile("server:onRequest", { catch: true });

// In the request handler - returns void if sync, Promise if async
const result = onRequest({ request, route });
if (result) await result;
```

This avoids the overhead of `emit()` in performance-critical code paths.
