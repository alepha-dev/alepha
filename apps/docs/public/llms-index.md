# Alepha

> Alepha is a convention-driven TypeScript framework for building robust, end-to-end type-safe full-stack applications.

## Overview

**Core Principles:**
- **Primitive Architecture**: Define features using `$`-prefixed primitives (`$action`, `$entity`, `$page`) that auto-register with the framework
- **Class-Based Services**: All services are classes, not functional components. Primitives are class properties.
- **Zero-Mapping**: No route files, no config files - code structure IS the configuration
- **End-to-End Type Safety**: Types flow from database schema -> API -> React components
- **Convention over Configuration**: Sensible defaults, minimal boilerplate
- **Dependency Injection**: Built-in DI container manages all service instances

**Built on**: Drizzle (ORM), React (SSR), Vite (bundler), TypeBox (validation)
**Runs on**: Node.js 22+, Bun, Cloudflare Workers, Vercel, Docker

**Quick Start**: `npx alepha init` - Creates minimal config files to use Alepha in current directory

### Rules

- use TypeScript (strict mode)
- use Biome for formatting and linting
- use Vitest for testing
- use Vite for bundling (full-stack)
- use React for frontend (full-stack)
- use Postgres or SQlite for database
- use TypeBox for schema definitions (not Zod!), using `t` from Alepha, not importing TypeBox directly
- use documentation: https://alepha.dev/llms.txt
- one file = one class
- primitives are always a class property, except for `$entity` to be drizzle-kit compatible
- no decorators, no functional services, no Express/Fastify patterns
- no manual instantiation, always use DI
- use import with file extensions (e.g. `import { User } from "./User.ts"`)

## Project Structure

```
my-app/
├── src/
│   ├── api/              # Backend (always use src/api/)
│   │   ├── controllers/  # API controllers with $action
│   │   ├── services/     # Business logic
│   │   ├── entities/     # Entities with $entity
│   │   ├── providers/    # External service providers
│   │   └── index.ts      # API module definition with $module
│   ├── web/              # Frontend (React/full-stack only)
│   │   ├── components/   # React components
│   │   ├── AppRouter.ts  # Router definition with $page
│   │   └── index.ts      # Web module definition with $module (React only)
│   ├── shared/           # Shared types/schemas
│   ├── main.server.ts    # Server entry (always use main.server.ts)
│   └── main.browser.ts   # Browser entry (React/full-stack only)
├── package.json
└── tsconfig.json
```

Note: Always use `src/api/` and `main.server.ts` even for API-only projects. The `src/web/`, `main.browser.ts` are only for React/full-stack apps. Each directory should have an `index.ts` that exports a `$module` grouping its services.

## Examples

### API + Database
```typescript
import { t } from "alepha";
import { $action } from "alepha/server";
import { $entity, $repository, db } from "alepha/orm";

const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(),
    email: t.email(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    deletedAt: pg.deletedAt() // Soft delete
  }),
  indexes: [
    { column: "email", unique: true }
  ]
});

class UserController {
  userRepo = $repository(userEntity);

  getUser = $action({
    path: "/users/:id",  // -> GET /api/users/:id
    schema: {
      params: t.object({ id: t.uuid() }),
      response: userEntity.schema,
    },
    handler: async ({ params }) => this.userRepo.findById(params.id),
  });

  createUser = $action({
    method: "POST",
    schema: {
      body: t.object({
        email: t.email(),
      }),
      response: userEntity.schema,
    },
    handler: async ({ body }) => this.userRepo.create(body),
  });
}
```

### React Page with SSR
```tsx
import { $page } from "@alepha/react/router";
import { $client } from "alepha/server/links";
import type { UserController } from "./UserController.ts";

class AppRouter {
  api = $client<UserController>(); // infer API client from controller

  users = $page({
    path: "/users",
    loader: async () => ({ users: await this.api.listUsers() }),
    component: ({ users }) => (
      <ul>
        {users.map(u => <li key={u.id}>{u.email}</li>)}
      </ul>
    ),
  });
}
```

### Entry Point
```typescript
// src/main.server.ts
import { run } from "alepha";
import { ApiModule } from "./api/index.ts";
import { WebModule } from "./web/index.ts"; // React only

run(ApiModule, WebModule);

// src/api/index.ts
import { $module } from "alepha";
import { UserController } from "./controllers/UserController.ts";

export const ApiModule = $module({
  name: "app.api",
  services: [UserController],
});
```

### Service Communication
```typescript
// Within same module - use $inject
class OrderService {
  userService = $inject(UserService);

  async createOrder(userId: string) {
    const user = await this.userService.findById(userId);
    // ...
  }
}

// Between frontend and backend - use $client
class AppRouter {
  api = $client<OrderController>();

  orders = $page({
    path: "/orders",
    loader: async () => ({ orders: await this.api.listOrders() }),
  });
}
```

### Testing
```typescript
import { describe, it, expect } from "vitest";
import { Alepha } from "alepha";

describe("UserService", () => {
  it("should create user", async () => {
    const alepha = Alepha.create().with(UserService);
    const service = alepha.inject(UserService);

    const user = await service.createUser({ email: "test@example.com" });
    expect(user.email).toBe("test@example.com");
  });
});
```

## Conventions

- `$action` paths auto-prefix with `/api`
- Method: GET default, POST if body schema exists
- Response schema strips undeclared fields (security)
- `t.` = TypeBox via `import { t } from "alepha"`
- Primitives are class properties, not standalone (except `$atom`, `$entity`)
- One file = one class
- Use import with file extensions (e.g. `import { User } from "./User.ts"`)
- Use `protected` instead of `private` for class members

## Common Mistakes to Avoid

1. **DON'T use decorators** - Alepha uses primitives, not decorators
2. **DON'T use Express/Fastify patterns** - No `app.get()`, `router.use()`, etc.
3. **DON'T use Zod** - Use TypeBox (`t`) for schemas
4. **DON'T use functional components for services** - Always use classes
5. **DON'T forget the `$` prefix** - All primitives start with `$`
6. **DON'T inject across modules** - Use `$client` for cross-module communication
7. **DON'T use async constructors** - Use `$hook({ on: "start" })` instead
8. **DON'T create instances manually** - Let the DI container manage them

## Quick Reference

Core utilities:

- `t` (TypeBox schemas) - `import { t } from "alepha"`
- `db` (database column helpers) - `import { db } from "alepha/orm"`

Core primitives:

- `$inject` - `import { $inject } from "alepha"`
- `$env` - `import { $env } from "alepha"`
- `$module` - `import { $module } from "alepha"`
- `$atom` - `import { $atom } from "alepha"`
- `$hook` - `import { $hook } from "alepha"`
- `$logger` - `import { $logger } from "alepha/logger"`
- `$action` - `import { $action } from "alepha/server"`
- `$route` - `import { $route } from "alepha/server"`
- `$entity` - `import { $entity } from "alepha/orm"`
- `$repository` - `import { $repository } from "alepha/orm"`
- `$page` - `import { $page } from "@alepha/react/router"`
- `$queue` - `import { $queue } from "alepha/queue"`
- `$scheduler` - `import { $scheduler } from "alepha/scheduler"`
- `$cache` - `import { $cache } from "alepha/cache"`
- `$bucket` - `import { $bucket } from "alepha/bucket"`
- `$issuer` - `import { $issuer } from "alepha/security"`
- `$realm` - `import { $realm } from "alepha/api/users"`
- `$command` - `import { $command } from "alepha/command"`

React hooks:

- `useStore` - `import { useStore } from "@alepha/react"`
- `useClient` - `import { useClient } from "@alepha/react"`
- `useInject` - `import { useInject } from "@alepha/react"`
- `useRouter` - `import { useRouter } from "@alepha/react/router"`
- `useForm` - `import { useForm } from "@alepha/react/form"`
- `useAuth` - `import { useAuth } from "@alepha/react/auth"`
- `useI18n` - `import { useI18n } from "@alepha/react/i18n"`

## Docs

- [Full Docs](https://alepha.dev/llms-full.txt): Complete documentation of Alepha with all details.
- [Examples](https://github.com/feunard/alepha/tree/main/apps): Example applications
