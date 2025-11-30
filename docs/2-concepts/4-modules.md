# Modules

When you are building a "Hello World" app, you can put everything in `main.ts`.
When you are building a SaaS platform, that approach turns into spaghetti code before lunch.

**Modules** are Alepha's tool for organizing code into logical, decoupled domains. They allow you to build a **Modular Monolith**: an application that runs as a single process but is structured like a set of independent microservices.

## Defining a Module

A module is simply a container that groups related Services, Providers, and Primitives. You define one using the `$module` primitive.

```ts
import { $module } from "alepha";
import { UserController } from "./UserController";
import { UserRepository } from "./UserRepository";

export const UserModule = $module({
  // Namespaces are important for logging and debugging
  name: "app.users",

  // Register all services belonging to this domain
  services: [
    UserController,
    UserRepository
  ]
});
```

Then, you register the module in your main entry point.

```ts
import { Alepha, run } from "alepha";
import { UserModule } from "./modules/users";
import { BillingModule } from "./modules/billing";

const app = Alepha.create()
  .with(UserModule)
  .with(BillingModule);

run(app);
```

## The Golden Rule: Boundaries

Here is where Alepha differs from other frameworks.

In a traditional Node.js app, it is tempting to just import `BillingService` into `UserService` and use it.
**Don't do this.**

If `Module A` directly `$inject`s a service from `Module B`, you have created a tight coupling. You cannot split them later. You cannot deploy them separately. You have created a "Distributed Monolith" worst-case scenario.

### How to communicate between modules

Alepha enforces a strict boundary using the **Links** system.

Instead of injecting the *instance* of another module's service, you create a **Client** that talks to its *API surface*.

```ts
import { $client } from "alepha/server/links";
import type { NotificationApi } from "../notifications/NotificationApi";

class UserService {
  // ❌ BAD: Tight coupling
  // notifications = $inject(NotificationService);

  // ✅ GOOD: Loose coupling via API contract
  notifications = $client<NotificationApi>();

  createUser = $action({
    handler: async ({ body }) => {
      // Create the user...

      // Call the other module
      // -> if both modules are local, this is a direct call
      // -> if remote, this is an remote call
      await this.notifications.sendWelcomeEmail({ email: body.email });
    }
  });
}
```

### Why do it this way?

1.  **Zero-Latency Local Calls:** When both modules are running in the same process (the Monolith), Alepha detects this. The `$client` call effectively becomes a direct function call. There is no HTTP overhead.
2.  **Location Transparency:** If your app grows and you decide to move `NotificationModule` to a separate server (Microservices), **you don't change a single line of code** in `UserService`. You just configure via `$remote` for the discovery.
3.  **Type Safety:** You still get full TypeScript autocomplete and validation for the remote module, because TypeBox schemas are shared.

## Summary

| Feature | Use `$inject` | Use `$client` |
| :--- | :--- | :--- |
| **Scope** | Inside the **same** module. | Across **different** modules. |
| **Performance** | Direct memory reference. | Optimized proxy (direct call or HTTP). |
| **Coupling** | High (Dependencies are hard-linked). | Low (Contract-based communication). |
| **Use Case** | Service logic, Database Repositories. | communicating between domains (e.g., Billing -> Users). |

Think of Modules as "Mini Applications" living together. Treat them with respect, keep their boundaries clean, and your codebase will remain maintainable for years.
