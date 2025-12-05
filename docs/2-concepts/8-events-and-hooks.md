# Events & Hooks

If you've ever used Express middleware or NestJS lifecycle hooks, you know how painful it can be to coordinate "when things happen" in your application.

Express gives you `app.use()` chains that execute in order. NestJS has `OnModuleInit`, `OnApplicationBootstrap`, and a dozen other interfaces to implement. Both approaches scatter your initialization logic across multiple files.

Alepha takes a different approach: **everything is an event**.

## The Lifecycle

When your Alepha app starts, it goes through four phases:

```
CONFIGURE  →  START  →  READY  →  (running)  →  STOP
```

- **Configure**: Schemas are validated, primitives are registered
- **Start**: Database connections open, HTTP server binds to port
- **Ready**: App is live, schedulers and queues begin processing
- **Stop**: Graceful shutdown, connections close

You hook into any of these with `$hook`.

## Using `$hook`

```typescript
import { $hook } from "alepha";
import { $logger } from "alepha/logger";

class DatabaseService {
  log = $logger();

  // runs when the app starts
  onStart = $hook({
    on: "start",
    handler: async () => {
      await this.connect();
      this.log.info("Database connected");
    }
  });

  // runs during graceful shutdown
  onStop = $hook({
    on: "stop",
    handler: async () => {
      await this.disconnect();
    }
  });
}
```

No interfaces to implement. No decorators to remember. Just declare what you need, where you need it.

### Hook Priority

Sometimes order matters. You want the database connected before the cache warms up.

```typescript
class CacheService {
  warmCache = $hook({
    on: "start",
    priority: 10, // higher = runs later
    handler: async () => {
      // database is already connected here
      await this.preloadFrequentData();
    }
  });
}
```

## The Event Bus

Beyond lifecycle hooks, Alepha has a full event system. Think of it as a typed EventEmitter on steroids.

```typescript
// emit an event
alepha.events.emit("user:created", { userId: "123" });

// listen to an event
alepha.events.on("user:created", ({ userId }) => {
  console.log(`New user: ${userId}`);
});
```

### Why Not Just Use EventEmitter?

Because `alepha.events` is **fully typed**. You get autocomplete. You get compile-time errors if you emit the wrong payload.

```typescript
// extend the Hooks interface for custom events
declare module "alepha" {
  interface Hooks {
    "user:created": { userId: string };
    "order:completed": { orderId: string; total: number };
  }
}

// now TypeScript knows the payload shape
alepha.events.emit("user:created", { userId: "abc" }); // ok
alepha.events.emit("user:created", { wrong: "key" });  // type error
```

## React Events

On the frontend, Alepha emits events during navigation and actions. This is gold for analytics, error tracking, or loading indicators.

```typescript
// available events
"react:action:begin"      // any user action started
"react:action:success"    // action completed
"react:action:error"      // action failed
"react:action:end"        // action finished (success or error)

"react:transition:begin"  // page navigation started
"react:transition:success"
"react:transition:error"
"react:transition:end"

"form:submit:begin"       // form submission
"form:submit:success"
"form:submit:error"
"form:submit:end"
```

### Global Error Toast

Here's a pattern we use in every project:

```typescript
// somewhere in your app initialization
alepha.events.on("react:action:error", ({ error }) => {
  toast.error(error.message);

  // send to Sentry, LogRocket, etc.
  Sentry.captureException(error);
});
```

One listener. Every error in your app gets a toast and gets tracked. No try/catch spaghetti.

### Loading Indicators

```typescript
const App = () => {
  const [loading, setLoading] = useState(false);

  useEvents({
    "react:transition:begin": () => setLoading(true),
    "react:transition:end": () => setLoading(false),
  }, []);

  return (
    <>
      {loading && <TopProgressBar />}
      <Outlet />
    </>
  );
};
```

## Comparison: NestJS vs Alepha

In NestJS, you implement interfaces:

```typescript
// nestjs way - scattered across the class
@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit() {
    await this.connect();
  }

  async onApplicationShutdown() {
    await this.disconnect();
  }
}
```

In Alepha, hooks are explicit properties:

```typescript
// alepha way - hooks are visible, named, self-documenting
class DatabaseService {
  connectOnStart = $hook({ on: "start", handler: () => this.connect() });
  disconnectOnStop = $hook({ on: "stop", handler: () => this.disconnect() });
}
```

The Alepha way is more verbose, sure. But when you're debugging "why isn't this running?", you can actually *see* the hooks. They have names. They show up in logs.

## When To Use What

| Need | Solution |
|------|----------|
| Run code at app startup/shutdown | `$hook({ on: "start" })` |
| Communicate between services | `alepha.events.emit()` |
| React to user actions in UI | `useEvents()` hook |
| Add analytics/error tracking | Listen to `react:action:*` events |

Events and hooks are the nervous system of your Alepha app. Once you start using them, you'll wonder how you ever lived without typed events.
