# Alepha Framework

Convention-driven TypeScript framework for type-safe full-stack applications.

## Philosophy

- **Primitives**: `$`-prefixed functions (`$action`, `$entity`, `$page`)
- **Class-Based**: Services are classes, primitives are class properties
- **Zero-Config**: Code structure IS configuration
- **End-to-End Types**: Database → API → React

## Rules

- Use `t` from Alepha for schemas (not Zod)
- Use `protected` instead of `private` for class members
- Import with file extensions: `import { User } from "./User.ts"`
- Primitives are class properties (except `$entity`, `$atom`)
- No decorators, no Express/Fastify patterns
- No manual instantiation - use dependency injection

## Project Structure

```
src/
├── api/                # Backend
│   ├── controllers/    # $action endpoints
│   ├── services/       # Business logic
│   ├── entities/       # $entity definitions
│   └── index.ts        # $module
├── web/                # Frontend (React)
│   ├── components/     # React components
│   ├── atoms/          # $atom state
│   ├── AppRouter.ts    # $page routes
│   └── index.ts        # $module
├── main.server.ts      # Server entry
├── main.browser.ts     # Browser entry
└── main.css            # Styles
```

## Primitives Reference

### Core (`alepha`)
| Primitive | Purpose |
|-----------|---------|
| `$inject` | Dependency injection |
| `$env` | Environment variables |
| `$hook` | Lifecycle hooks (on: "start", "stop") |
| `$atom` | Global state (module-level) |
| `$module` | Module definition |
| `$context` | Request-scoped context |

### Server (`alepha/server`)
| Primitive | Purpose |
|-----------|---------|
| `$action` | REST API endpoints (auto GET/POST) |
| `$route` | Low-level HTTP routes |
| `$client` | Type-safe HTTP client for cross-module |

### Database (`alepha/orm`)
| Primitive | Purpose |
|-----------|---------|
| `$entity` | Database table definition |
| `$repository` | Type-safe CRUD operations |
| `$sequence` | Auto-increment sequences |

### Infrastructure
| Primitive | Import | Purpose |
|-----------|--------|---------|
| `$logger` | `alepha/logger` | Structured logging |
| `$queue` | `alepha/queue` | Background jobs |
| `$scheduler` | `alepha/scheduler` | Cron tasks |
| `$cache` | `alepha/cache` | Cached computations |
| `$bucket` | `alepha/bucket` | File storage |
| `$email` | `alepha/email` | Email sending |
| `$sms` | `alepha/sms` | SMS sending |
| `$lock` | `alepha/lock` | Distributed locks |
| `$retry` | `alepha/retry` | Retry with backoff |

### Security (`alepha/security`)
| Primitive | Purpose |
|-----------|---------|
| `$issuer` | JWT token generation/validation |
| `$permission` | Permission definitions |
| `$role` | Role-based access |
| `$basicAuth` | HTTP Basic Auth |
| `$serviceAccount` | Service-to-service auth |

### React (`alepha/react/router`)
| Primitive | Purpose |
|-----------|---------|
| `$page` | Pages with SSR, loaders, code-splitting |
| `$head` | Document head management |
| `$dictionary` | i18n translations |

### Other
| Primitive | Import | Purpose |
|-----------|--------|---------|
| `$command` | `alepha/command` | CLI commands |
| `$swagger` | `alepha/server` | OpenAPI docs |
| `$proxy` | `alepha/server` | HTTP proxy |
| `$tool` | `alepha/mcp` | MCP tool definition |
| `$prompt` | `alepha/mcp` | MCP prompt definition |
| `$resource` | `alepha/mcp` | MCP resource definition |

## React Hooks

```typescript
import { useAlepha, useClient, useStore, useAction, useInject } from "alepha/react";
import { useRouter, useActive, useQueryParams } from "alepha/react/router";
import { useForm, useFormState } from "alepha/react/form";
import { useAuth } from "alepha/react/auth";
import { useHead } from "alepha/react/head";
import { useI18n } from "alepha/react/i18n";
```

| Hook | Purpose |
|------|---------|
| `useClient<T>()` | Type-safe API calls |
| `useStore(atom)` | Global state `[value, setValue]` |
| `useAction({ handler })` | Async ops with loading/error |
| `useRouter<T>()` | Type-safe navigation |
| `useActive(path)` | Check if route is active |
| `useForm({ schema, handler })` | Forms with validation |
| `useAuth()` | Authentication state |
| `useInject(Service)` | Access DI container |

## Examples

### API Endpoint
```typescript
import { t } from "alepha";
import { $action } from "alepha/server";

class UserController {
  getUser = $action({
    path: "/users/:id",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: t.object({ id: t.uuid(), email: t.email() }),
    },
    handler: async ({ params }) => this.userRepo.findById(params.id),
  });
}
```

### Entity & Repository
```typescript
import { t } from "alepha";
import { $entity, $repository, db } from "alepha/orm";

export const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(),
    email: t.email(),
    createdAt: db.createdAt(),
  }),
});

class UserService {
  users = $repository(userEntity);
}
```

### Page with Loader
```tsx
import { t } from "alepha";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

class AppRouter {
  api = $client<UserController>();

  userDetail = $page({
    path: "/users/:id",
    schema: { params: t.object({ id: t.uuid() }) },
    loader: async ({ params }) => ({
      user: await this.api.getUser({ params })
    }),
    component: ({ user }) => <div>{user.email}</div>,
  });
}
```

### Form
```tsx
import { t } from "alepha";
import { useForm } from "alepha/react/form";

function LoginForm() {
  const form = useForm({
    schema: t.object({
      email: t.email(),
      password: t.text(),
    }),
    handler: async (values) => {
      await api.login(values);
    },
  });

  return (
    <form {...form.props}>
      <input {...form.input.email.props} />
      <input {...form.input.password.props} />
      <button type="submit">Login</button>
    </form>
  );
}
```

## Schema Types (`t`)

```typescript
import { t } from "alepha";

t.string()              // Basic string
t.text()                // String with maxLength, trim, lowercase options
t.email()               // Email validation
t.uuid()                // UUID validation
t.number()              // Number
t.integer()             // Integer
t.boolean()             // Boolean
t.date()                // Date
t.array(t.string())     // Array
t.object({ ... })       // Object
t.optional(t.string())  // Optional
t.nullable(t.string())  // Nullable
t.enum(["a", "b"])      // Enum
t.literal("value")      // Literal
t.union([...])          // Union
```

## Common Mistakes

1. Using decorators → Use primitives (`$action`, not `@Get()`)
2. Using Zod → Use `t` from Alepha
3. Using Express patterns → No `app.get()`, `router.use()`
4. Using `$inject` across modules → Use `$client` instead
5. Using async constructors → Use `$hook({ on: "start" })`
6. Manual instantiation → Let DI container manage

## Source Code

Read implementation at `src/` directory. Check `.spec.ts` files for usage examples.
