## 🎯 Framework Overview

Alepha is a convention-driven, class-based TypeScript framework that uses **descriptors** (factory functions starting with `$`) to define application components.
It's NOT a wrapper around Express/Fastify but a complete framework built from scratch.

### Core Principles
1. **Class-based architecture** - All services are classes, not functional components
2. **Descriptor pattern** - Use `$` prefixed functions to declare functionality
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
- descriptors are always a class property, except for `$entity` to be drizzle-kit compatible
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
│   ├── index.server.ts   # Server entry point
│   └── index.browser.ts  # Browser entry point (if full-stack)
├── package.json
├── tsconfig.json
├── vite.config.ts        # If using full-stack features
└── index.html            # If using full-stack features
```

### Rule 2: Always Use Classes and Descriptors

```typescript
// ✅ CORRECT - Alepha way
import { $action, $inject } from "alepha";
import { $logger } from "alepha/logger";

class UserController {
  log = $logger();
  userService = $inject(UserService);

  getUser = $action({
    schema: t.object({
      params: t.object({
        id: t.string()
      })
    }),
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
// Server entry (src/index.server.ts)
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
const UserSchema = t.object({
  id: t.string({ format: "uuid" }),
  email: t.string({ format: "email" }),
  age: t.number({ minimum: 0, maximum: 120 }),
  isActive: t.boolean({ default: true })
});

// ❌ WRONG - Zod schemas
import { z } from "zod"; // DON'T USE THIS!
```

### Rule 5: Database with Postgres Module

```typescript
import { pg, $entity, $repository } from "alepha/postgres";
import { t } from "alepha";

// Define entity with TypeBox schema
const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    email: t.string({ format: "email" }),
    name: t.string(),
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

  async createUser(data: any) {
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
    schema: t.object({
      response: t.array(productSchema), // response schema is mandatory for json response
    }),
    handler: async () => {
      return await this.products.find();
    }
  });

  // POST /products
  createProduct = $action({
    method: "POST",
    schema: t.object({
      body: t.object({ // body schema is mandatory for request json body
        name: t.string(),
        price: t.number({ minimum: 0 })
      }),
      response: productSchema,
    }),
    handler: async ({ body }) => {
      return await this.products.create(body);
    }
  });

  // GET /products/:id
  getProduct = $action({
    path: "/products/:id",
    schema: t.object({
      params: t.object({
        id: t.string()
      }),
      response: productSchema,
    }),
    handler: async ({ params }) => {
      return await this.products.findById(params.id);
    }
  });
}
```

### Rule 7: Full-Stack with React

```typescript
// AppRouter.ts
import { $page } from "alepha/react";

export class AppRouter {
  layout = $page({
    lazy: () => import("./components/Layout"),
    children: () => [this.home, this.about]
  });

  home = $page({
    path: "/",
    lazy: () => import("./components/Home"),
    resolve: async () => {
      // Server-side data fetching
      const data = await fetchHomeData();
      return { data };
    }
  });

  about = $page({
    path: "/about",
    lazy: () => import("./components/About")
  });
}

// vite.config.ts
import { viteAlepha } from "alepha/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    viteReact(),
    viteAlepha({
      serverEntry: "./src/index.server.ts"
    })
  ]
});
```

### Rule 8: Common Descriptors Reference

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

1. **DON'T use decorators** - Alepha uses descriptors, not decorators
2. **DON'T use Express/Fastify patterns** - No `app.get()`, `router.use()`, etc.
3. **DON'T use Zod** - Use TypeBox (`t`) for schemas
4. **DON'T use functional components for services** - Always use classes
5. **DON'T forget the `$` prefix** - All descriptors start with `$`
6. **DON'T inject across modules** - Use `$client` for cross-module communication
7. **DON'T use async constructors** - Use `$hook({ on: "start" })` instead
8. **DON'T create instances manually** - Let the DI container manage them

## 🎨 Code Generation Template

```typescript
// 1. Import Alepha essentials
import { Alepha, run, t, $logger, $inject } from "alepha";
import { $action } from "alepha/server";
import { $entity, $repository } from "alepha/postgres";
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
      return await this.service.findAll();
    }
  });

  create = $action({
    method: "POST",
    schema: t.object({
      body: t.object({
        // ... fields
      })
    }),
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
    "alepha": "latest",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^5.0.0",
    "vitest": "^1.0.0",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "start": "node dist/server/index.js",
    "test": "vitest"
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
    "forceConsistentCasingInFileNames": true
  }
}
```

## 🎯 When Generating Code

1. **Start with the entity/data model** using `$entity`
2. **Create services** with `$repository` for data access
3. **Add business logic** in service classes
4. **Expose APIs** with `$action` in controllers
5. **Wire everything** in the main entry point with `Alepha.create().with()`
6. **For full-stack**, add `$page` descriptors and React components

## 💡 Pro Tips

- Use `$logger()` extensively for debugging
- Leverage `$hook({ on: "start" })` for initialization
- Use `$cache()` to wrap expensive operations
- Implement `$queue()` for background processing
- Add `$scheduler()` for recurring tasks
- Use transactions with `$transaction()` for data consistency
- Implement `$lock()` for distributed systems
- Always type your schemas with TypeBox (`t`)

Remember: Alepha is about **declarative, class-based services** with **descriptor-driven functionality**. Think in terms of services, not routes or middleware!
