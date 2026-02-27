# Primitives

If services are the "classes" of your application, **Primitives** are the "superpowers" you attach to them.

In other tools, you might use **Decorators** (like `@Get()` in NestJS) or **File-System naming conventions** (like `+page.server.ts` in SvelteKit) to define special behavior.

In Alepha, we use **Primitives**. These are factory functions, always prefixed with `$`, that you assign to class properties. They tell the engine: *"This isn't just a variable. This is an API endpoint, a database table, or a background job."*

## How they work

You don't need to register routes in a separate file. You don't need to configure a queue worker in a different folder. You declare the behavior right next to the logic.

```ts
import { $logger } from "alepha/logger";
import { $action } from "alepha/server";
import { $scheduler } from "alepha/scheduler";

class UserController {
  // 1. Inject a utility
  log = $logger();

  // 2. Define an HTTP Endpoint
  list = $action({
    path: "/users",
    handler: async () => {
      return ["Alice", "Bob"];
    }
  });

  // 3. Define a Cron Job
  cleanup = $scheduler({
    cron: "0 0 * * *", // Every midnight
    handler: async () => {
      this.log.info("Cleaning up old users...");
    }
  });
}
```

When you run your app, Alepha scans your classes. It sees `$action`, so it creates a route. It sees `$scheduler`, so it starts a cron job. It handles the wiring so you can handle the code.

## The Standard Library

Alepha comes with over 50 Primitives out of the box. Here are the ones you will use every day.

### Core & Dependency Injection
The glue that holds your app together.
*   **`$inject`**: The Dependency Injection mechanism. Access other services instantly.
*   **`$env`**: Type-safe access to environment variables. Validates `.env` files at startup.
*   **`$logger`**: Context-aware logging (knows which module/service called it).

### HTTP & Server
Building APIs and managing requests.
*   **`$action`**: The star of the show. Defines a type-safe REST endpoint with input/output validation (via TypeBox) and automatic Swagger generation.
*   **`$cookie`**: Secure, encrypted, and signed cookie management.

### Data & Persistence
Working with Postgres or SQLite.
*   **`$entity`**: Defines a database table schema.
*   **`$repository`**: Creates a fully typed repository for an entity with built-in CRUD (create, find, update, delete).

### Infrastructure
Powerful backend features without the setup pain.
*   **`$queue`**: A background job queue (backed by memory or Redis).
*   **`$scheduler`**: Cron jobs and recurring tasks.
*   **`$cache`**: Caches the result of a function (in memory or Redis).
*   **`$bucket`**: File storage abstraction (upload to local disk, S3, or Azure).

### Frontend (React)
Full-stack integration.
*   **`$page`**: Defines a React route (SSR/CSR) with server-side data fetching.
*   **`$head`**: Manages document `<head>` (title, meta tags).

## Creating your own

Primitives aren't magic. They are just functions.
As you get advanced with Alepha, you can write your own Primitives to encapsulate complex logic (like `$index` for ElasticSearch) and share them across your projects.
