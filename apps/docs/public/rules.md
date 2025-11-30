## Framework Overview

Alepha is a convention-driven, class-based TypeScript framework that uses **primitives** (factory functions starting with `$`) to define application components.
It's NOT a wrapper around Express/Fastify but a complete framework built from scratch.

### Core Principles
1. **Class-based architecture** - All services are classes, not functional components
2. **Primitive pattern** - Use `$` prefixed functions to declare functionality
3. **Dependency injection** - Built-in DI container manages all services
4. **Type-safe from database to frontend** - Full TypeScript with TypeBox schemas
5. **Convention over configuration** - Opinionated structure with clear patterns

### Rules Summary

- use TypeScript (strict mode)
- use Biome for formatting and linting
- use Vitest for testing
- use Vite for bundling (full-stack)
- use React for frontend (full-stack)
- use Postgres for database (with built-in support)
- use TypeBox for schema definitions (not Zod!), using `t` from Alepha, not importing TypeBox directly
- use documentation: https://alepha.dev/llms.txt
- one file = one class
- primitives are always a class property, except for `$entity` to be drizzle-kit compatible
- no decorators, no functional services, no Express/Fastify patterns
- no manual instantiation, always use DI
- use import with file extensions (e.g. `import { User } from "./User.ts"`)

## 📋 Essential Rules for Code Generation

### Rule 1: Project Structure

```
my-app/
├── src/
│   ├── server/           # Backend services
│   │   ├── controllers/  # API controllers with $action
│   │   ├── services/     # Business logic
│   │   ├── entities/     # Entities with $entity
│   │   └── providers/    # External service providers
│   ├── client/           # Frontend (if full-stack)
│   │   ├── components/   # React components
│   │   └── AppRouter.ts  # Router definition, with $page
│   ├── shared/           # Shared types/schemas
│   ├── main.server.ts    # Server entry point
│   └── main.browser.ts   # Browser entry point (if full-stack)
├── package.json
├── tsconfig.json
├── vite.config.ts        # If using full-stack features
└── index.html            # If using full-stack features
```

### Rule 2: Always Use Classes and Primitives

```typescript
// ✅ CORRECT - Alepha way
import { $action, $inject } from "alepha";
import { $logger } from "alepha/logger";

class UserController {
  log = $logger();
  userService = $inject(UserService);

  getUser = $action({
    schema: {
      params: t.object({
        id: t.text()
      })
    },
    handler: async ({ params }) => {
      this.log.info(`Getting user ${params.id}`);
      return await this.userService.findById(params.id);
    }
  });
}

// ❌ WRONG - Traditional Express/Fastify way
const router = express.Router();
router.get('/users/:id', async (req, res) => {
  // This is NOT how Alepha works!
});
```

### Rule 3: Entry Point Pattern (server and browser)

```typescript
// Server entry (src/main.server.ts)
import { Alepha, run } from "alepha";
import { UserController } from "./controllers/UserController";

const alepha = Alepha.create()
  .with(UserController)
  .with(DatabaseService);

run(alepha);

// Or for simple apps
import { run } from "alepha";
run(UserController);
```

### Rule 4: TypeBox Schemas (Not Zod!)

```typescript
import { t } from "alepha"; // TypeBox, NOT zod!

// ✅ CORRECT - TypeBox schemas
const userSchema = t.object({
  id: t.uuid(),
  email: t.text({ format: "email" }),
  age: t.number({ minimum: 0, maximum: 120 }),
  isActive: t.boolean({ default: true })
});

// ❌ WRONG - Zod schemas
import { z } from "zod"; // DON'T USE THIS!
```

### Rule 5: Database with Postgres Module

```typescript
import { pg, $entity, $repository } from "alepha/orm";
import { t, type Static } from "alepha";

// Define entity with TypeBox schema
const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    email: t.text({ format: "email" }),
    name: t.text(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    deletedAt: pg.deletedAt() // Soft delete
  }),
  indexes: [
    { column: "email", unique: true }
  ]
});

// Use in service
class UserService {
  userRepository = $repository(users);

  async createUser(data: Static<typeof users.insertSchema>) {
    return await this.userRepository.create(data);
  }

  async findByEmail(email: string) {
    return await this.userRepository.findOne({ email });
  }
}
```

### Rule 6: API Endpoints with $action

```typescript
import { $action } from "alepha/server";
import { t } from "alepha";

class ProductController {
  // GET /products
  listProducts = $action({
    schema: {
      response: t.array(productSchema), // response schema is mandatory for json response
    },
    handler: async () => {
      return await this.products.find();
    }
  });

  // POST /products
  createProduct = $action({
    method: "POST",
    schema: {
      body: t.object({ // body schema is mandatory for request json body
        name: t.text(),
        price: t.number({ minimum: 0 })
      }),
      response: productSchema,
    },
    handler: async ({ body }) => {
      return await this.products.create(body);
    }
  });

  // GET /products/:id
  getProduct = $action({
    path: "/products/:id",
    schema: {
      params: t.object({
        id: t.text()
      }),
      response: productSchema,
    },
    handler: async ({ params }) => {
      return await this.products.findById(params.id);
    }
  });
}
```

### Rule 7: Full-Stack with React

```typescript
// AppRouter.ts
import { $page } from "@alepha/react";

export class AppRouter {
  layout = $page({
    lazy: () => import("./components/Layout.tsx"),
    children: () => [this.home, this.about]
  });

  home = $page({
    path: "/",
    lazy: () => import("./components/Home.tsx"),
    resolve: async () => {
      // Server-side data fetching
      const data = await fetchHomeData();
      return { data };
    }
  });

  about = $page({
    path: "/about",
    lazy: () => import("./components/About.tsx")
  });
}

// vite.config.ts
import { viteAlepha } from "alepha/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    viteAlepha({
      serverEntry: "./src/main.server.ts"
    })
  ]
});
```

### Rule 8: Common Primitives Reference

```typescript
// Core
$inject(ServiceClass)     // Dependency injection
$env(schema)              // Environment variables
$logger(name?)            // Logging
$hook({ on, handler })    // Lifecycle hooks
$module({ name, services }) // Module definition

// Server
$action({ method?, path?, schema?, handler }) // API endpoint
$route({ method?, path?, handler })           // Simple route
$middleware({ handler })                      // Middleware

// Database (postgres)
$entity({ name, schema, indexes })     // Table definition
$repository(entity)                    // Repository for entity
$transaction({ handler })               // Database transaction
$sequence({ name, start, increment })   // ID sequence

// Features
$cache({ name?, ttl, handler })        // Caching
$queue({ handler })                     // Background jobs
$scheduler({ cron, handler })          // Scheduled tasks
$email({ subject, body, schema })      // Email templates
$bucket({ name, mimeTypes, maxSize })  // File storage
$lock({ handler })                      // Distributed locks
$topic({ name })                        // Pub/sub topics
$subscriber({ topic, handler })        // Topic subscriber
$batch({ schema, maxSize, handler })   // Batch processing

// React
$page({ path?, lazy, resolve?, children? }) // Page definition
```

### Rule 9: Service Communication

```tsx
// Within same module - use $inject
class ServiceA {
    serviceB = $inject(ServiceB);

    async doSomething() {
        return await this.serviceB.process();
    }
}

// Between modules - use $client
import {$client} from "alepha/server/links";
import type {UserController} from "../server/controllers/UserController.ts";

class UserController {
    notifications = $client<NotificationController>();

    createUser = $action({
        handler: async (data) => {
            const user = await this.users.create(data);
            await this.notifications.sendWelcome(user.email);
            return user;
        }
    });
}

// Between frontend and backend - use $client
import {$client} from "alepha/server/links";
import type {UserController} from "../server/controllers/UserController.ts";
import type {User} from "../server/entities/users.ts";
class UserProfile {
    userApi = $client<UserController>();

    home = $page({
        path: "/",
        lazy: () => import("./Home.tsx"),
        resolve: async () => {
            return {
                user: await this.userApi.getMyUserProfile(data)
            };
        }
    })
}

const Home = ({user}: {user: User}) => {
    const userApi = useClient<UserController>();
    return <div>Welcome, {user.name}</div>;
};
```

### Rule 10: Testing Pattern

```typescript
import { describe, it, expect } from "vitest";
import { Alepha } from "alepha";

describe("UserService", () => {
  const alepha = Alepha.create()
    .with(UserService);

  it("should create user", async () => {
    const service = alepha.inject(UserService);
    const user = await service.createUser({
      email: "test@example.com"
    });
    expect(user.email).toBe("test@example.com");
  });
});
```

## 🚫 Common Mistakes to Avoid

1. **DON'T use decorators** - Alepha uses primitives, not decorators
2. **DON'T use Express/Fastify patterns** - No `app.get()`, `router.use()`, etc.
3. **DON'T use Zod** - Use TypeBox (`t`) for schemas
4. **DON'T use functional components for services** - Always use classes
5. **DON'T forget the `$` prefix** - All primitives start with `$`
6. **DON'T inject across modules** - Use `$client` for cross-module communication
7. **DON'T use async constructors** - Use `$hook({ on: "start" })` instead
8. **DON'T create instances manually** - Let the DI container manage them

## 🎨 Code Generation Template

```typescript
// 1. Import Alepha essentials
import { Alepha, run, t, $logger, $inject } from "alepha";
import { $action } from "alepha/server";
import { $entity, $repository } from "alepha/orm";
import { pg } from "alepha";

// 2. Define entities
const users = $entity({
  name: "table_name",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    // ... fields
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt()
  }),
  indexes: []
});

// 3. Create repository service
class EntityService {
  userRepo = $repository(users);
  log = $logger();

  async create(data: any) {
    this.log.info("Creating entity");
    return await this.userRepo.create(data);
  }
}

// 4. Create controller
class EntityController {
  service = $inject(EntityService);

  list = $action({
    handler: async () => {
      return await this.service.find();
    }
  });

  create = $action({
    method: "POST",
    schema: {
      body: t.object({
        // ... fields
      })
    },
    handler: async ({ body }) => {
      return await this.service.create(body);
    }
  });
}

// 5. Bootstrap application
const alepha = Alepha.create()
  .with(EntityService)
  .with(EntityController);

run(alepha);
```

## 📦 Package.json Requirements

```json
{
  "type": "module",
  "dependencies": {
    "alepha": "latest"
  },
  "scripts": {
    "dev": "alepha dev",
    "build": "alepha build",
    "test": "alepha test"
  }
}
```

## 🔧 TSConfig Requirements

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "esnext",
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true
  }
}
```

## 🎯 When Generating Code

1. **Start with the entity/data model** using `$entity`
2. **Create services** with `$repository` for data access
3. **Add business logic** in service classes
4. **Expose APIs** with `$action` in controllers
6. **For full-stack**, add `$page` primitives and React components

## 💡 Pro Tips

- Use `$logger()` extensively for debugging
- Leverage `$hook({ on: "start" })` for initialization
- Use `$cache()` to wrap expensive operations
- Implement `$queue()` for background processing
- Add `$scheduler()` for recurring tasks
- Use transactions with `$transaction()` for data consistency
- Implement `$lock()` for distributed systems
- Always type your schemas with TypeBox (`t`)
  - t.uuid() for UUID
  - t.datetime() for date-time

Remember: Alepha is about **declarative, class-based services** with **primitive-driven functionality**. Think in terms of services, not routes or middleware!


## Modules

Alepha is modular, with a LOT of modules.

### Core & Application Layer

*   **Core ([alepha](https://feunard.github.io/alepha/docs/alepha-core)) 📦:** The heart of the framework, providing a powerful dependency injection container, application lifecycle management, and the core primitive system.
*   **Server ([alepha/server](https://feunard.github.io/alepha/docs/alepha-server)) 🌐:** A high-performance, minimalist HTTP server for creating type-safe REST APIs using declarative `$action` primitives.
*   **Database ([alepha/orm](https://feunard.github.io/alepha/docs/alepha-postgres)) 🗄️:** A powerful and type-safe ORM built on Drizzle. Define your schema with `$entity` and get fully-typed repositories with `$repository`.
*   **React ([@alepha/react](https://feunard.github.io/alepha/docs/alepha-react)) ⚛️:** Build full-stack, server-side rendered React applications with a file-based routing system (`$page`) that handles data fetching, hydration, and type-safe props.

### Backend Infrastructure & Abstractions

*   **Security ([alepha/security](https://feunard.github.io/alepha/docs/alepha-security)) 🛡️:** A complete authentication and authorization system. Manage roles (`$role`), permissions (`$permission`), JWTs, and realms (`$realm`).
*   **Queue ([alepha/queue](https://feunard.github.io/alepha/docs/alepha-queue)) ⏳:** A simple and robust interface for background job processing. Define workers with the `$queue` primitive and integrate with backends like Redis.
*   **Cache ([alepha/cache](https://feunard.github.io/alepha/docs/alepha-cache)) ⚡:** A flexible caching layer with support for TTL, automatic function caching (`$cache`), and multiple backends like in-memory or Redis.
*   **Bucket ([alepha/bucket](https://feunard.github.io/alepha/docs/alepha-bucket)) ☁️:** A unified API for file and object storage. Abstract away the details of local, in-memory, or cloud storage providers like Azure Blob Storage.
*   **Scheduler ([alepha/scheduler](https://feunard.github.io/alepha/docs/alepha-scheduler)) ⏰:** Schedule recurring tasks using cron expressions or fixed intervals with the `$scheduler` primitive, with built-in support for distributed locking.
*   **Topic ([alepha/topic](https://feunard.github.io/alepha/docs/alepha-topic)) 📢:** A publish-subscribe (pub/sub) messaging interface for building event-driven architectures with `$topic` and `$subscriber`.
*   **Lock ([alepha/lock](https://feunard.github.io/alepha/docs/alepha-lock)) 🔒:** A distributed locking mechanism to ensure safe concurrent access to shared resources, using Redis or other backends.

### Server Middleware & Plugins

*   **Links ([alepha/server/links](https://feunard.github.io/alepha/docs/alepha-server-links)) 🔗:** Enables end-to-end type-safe communication between your frontend and backend, or between microservices, with the `$client` primitive.
*   **Swagger ([alepha/server/swagger](https://feunard.github.io/alepha/docs/alepha-server-swagger)) 📜:** Automatically generate OpenAPI 3.0 documentation and a beautiful Swagger UI for all your `$action` API endpoints.
*   **Helmet ([alepha/server/helmet](https://feunard.github.io/alepha/docs/alepha-server-helmet)) 🎩:** Enhance your application's security by automatically applying essential HTTP security headers like CSP and HSTS.
*   **CORS ([alepha/server/cors](https://feunard.github.io/alepha/docs/alepha-server-cors)) ↔️:** A configurable middleware to handle Cross-Origin Resource Sharing (CORS) for your server.
*   **Multipart ([alepha/server/multipart](https://feunard.github.io/alepha/docs/alepha-server-multipart)) 📎:** Seamlessly handle `multipart/form-data` requests for file uploads.
*   **Compress ([alepha/server/compress](https://feunard.github.io/alepha/docs/alepha-server-compress)) 📦💨:** Automatically compress server responses with Gzip or Brotli to improve performance.

And more, like **Request Logging**, **Error Handling**, and **Response Caching**, cookie parsers, and more, to enhance your server's capabilities.

### Full-Stack & React Ecosystem

*   **Auth ([@alepha/react/auth](https://feunard.github.io/alepha/docs/alepha-react-auth)) 🔑:** Simplifies frontend authentication flows, providing the `useAuth` hook to manage user sessions and permissions in your React components.
*   **Head ([@alepha/react/head](https://feunard.github.io/alepha/docs/alepha-react-head))  SEO:** Manage your document's `<head>` for SEO and metadata. Control titles, meta tags, and more, both on the server and client.
*   **i18n ([@alepha/react/i18n](https://feunard.github.io/alepha/docs/alepha-react-i18n)) 🌍:** A complete internationalization solution for your React applications, with support for lazy-loaded translation files and the `useI18n` hook.
*   **Form ([@alepha/react/form](https://feunard.github.io/alepha/docs/alepha-react-form)) 📝:** Create powerful, type-safe forms with automatic validation using the `useForm` hook, powered by your TypeBox schemas.

### Tooling & Utilities

*   **Vite ([alepha/vite](https://feunard.github.io/alepha/docs/alepha-vite)) ✨:** A seamless Vite plugin that handles all the complex build and development server configurations for your full-stack Alepha applications.
*   **Command ([alepha/command](https://feunard.github.io/alepha/docs/alepha-command)) ⌨️:** Build powerful, type-safe command-line interfaces and scripts directly within your application using the `$command` primitive.
*   **Retry ([alepha/retry](https://feunard.github.io/alepha/docs/alepha-retry)) 🔄:** A declarative and powerful decorator (`$retry`) for automatically retrying failed operations with exponential backoff.
