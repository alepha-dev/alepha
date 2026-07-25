# Modules

`$module` groups related services into named, self-contained units. It helps organize large applications into domain-driven bounded contexts.

## When to Use Modules

Do not use modules for small applications. They add structure that only pays off at scale.

A reasonable guideline: introduce modules when you have more than 30 actions in a single codebase. An application with 100 actions should have at least 3 modules.

It's also highly recommended in full-stack mode to make 2 modules: `api` (server) and `web` (client). The `api` module contains all server-side services and actions. The `web` module contains all client-side services (e.g. React components, hooks, etc). This keeps server and client code separate and prevents accidental imports of server-only code into the client.

## Basic Usage

```typescript check
import { $module } from "alepha";

class PaymentService { /* ... */ }
class InvoiceService { /* ... */ }

const billingModule = $module({
  name: "billing",
  services: [PaymentService, InvoiceService],
});
```

Register the module with the container:

```typescript
const alepha = Alepha.create().with(billingModule);
```

All services listed in `services` are automatically instantiated and registered in the container when the module is loaded.

## Module Names

Module names must follow the pattern `project.module.submodule` -- lowercase letters, hyphens, and dots:

```
core                    // valid
my.app                  // valid
my.app.billing          // valid
my-app.billing          // valid
```

The regex: `/^[a-z-]+(\.[a-z-][a-z0-9-]*)*$/`

Module names are used in logging. Each service in a module has its logger prefixed with the module name:

```
[23:45:53.326] INFO <billing.PaymentService>: Processing payment
```

This enables per-module log level configuration:

```bash
LOG_LEVEL=billing:debug,info
```

## Module Options

```typescript
interface ModulePrimitiveOptions {
  name: string;                            // required
  services?: Array<Service>;               // services to register
  primitives?: Array<PrimitiveFactoryLike>; // primitive factories to associate
  atoms?: Array<Atom<any>>;                // atoms to register in state
  register?: (alepha: Alepha) => void;     // custom registration logic
}
```

## Automatic vs Manual Registration

By default, all services in the `services` array are instantiated automatically:

```typescript
const mod = $module({
  name: "my.module",
  services: [A, B, C], // all three are registered
});
```

If you provide a `register` function, automatic registration is disabled. You must handle all registration manually:

```typescript
const mod = $module({
  name: "my.module",
  services: [A, B, C],
  register: (alepha) => {
    alepha.with(B); // only B is registered
    // A and C are NOT registered unless explicitly added
  },
});
```

This is useful for conditional registration or specific initialization order.

## Module Dependencies

Modules can contain other modules in their `services` array:

```typescript
class RandomService {
  very = $inject(VeryRandomService);
}

const CoreModule = $module({
  name: "core",
  services: [RandomService, VeryRandomService],
});

class DatabaseService { /* ... */ }

const DatabaseModule = $module({
  name: "database",
  services: [DatabaseService],
});

class ServerProvider { /* ... */ }

const ServerModule = $module({
  name: "server",
  services: [CoreModule, DatabaseModule, ServerProvider], // this is valid
});

const alepha = Alepha.create().with(ServerModule);
```

Each service retains its own module context. `RandomService` belongs to `"core"`, `DatabaseService` belongs to `"database"`, and `ServerProvider` belongs to `"server"`.

## Auto-Discovery

If a service has a `[MODULE]` association (set by `$module`), injecting that service anywhere will automatically load its parent module:

```typescript
const billingModule = $module({
  name: "billing",
  services: [PaymentService],
});

// In another service, just inject PaymentService directly.
// The billing module is loaded automatically.
class OrderService {
  payments = $inject(PaymentService);
}
```

There is no need to explicitly register `billingModule` if something already depends on one of its services.

## Registering Atoms

Modules can register atoms in their state:

```typescript
import { $atom, $module, z } from "alepha";

const billingConfig = $atom({
  name: "billing:config",
  schema: z.object({
    currency: z.text({ default: "USD" }),
    taxRate: z.number().default(0.2),
  }),
  default: { currency: "USD", taxRate: 0.2 },
});

const billingModule = $module({
  name: "billing",
  services: [PaymentService],
  atoms: [billingConfig],
});
```

## Dependency Graph

Inspect the dependency graph to see module associations:

```typescript
const alepha = Alepha.create().with(ServerModule);
console.log(alepha.graph());
// {
//   RandomService: { from: ["core"], module: "core" },
//   DatabaseService: { from: ["database"], module: "database" },
//   ServerProvider: { from: ["server"], module: "server" },
//   ...
// }
```

Alepha has also a built-in graph visualization tool in `alepha/devtools` that shows module boundaries and dependencies.
