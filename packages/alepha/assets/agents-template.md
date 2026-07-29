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
| `$relations` | How entities relate; read with `include` |
| `$repository` | Type-safe CRUD operations |
| `$repositories` | One binding per entity of a `$relations` schema |
| `$sequence` | Auto-increment sequences |

### Infrastructure
| Primitive | Import | Purpose |
|-----------|--------|---------|
| `$logger` | `alepha/logger` | Structured logging |
| `$job` | `alepha/api/jobs` | Background jobs AND cron — durable, retried, crash-safe |
| `$cache` | `alepha/cache` | Cached computations |
| `$storage` | `alepha/api/files` | File storage with metadata, TTL, querying |
| `$email` | `alepha/email` | Email sending |
| `$sms` | `alepha/sms` | SMS sending |
| `$lock` | `alepha/lock` | Distributed locks |
| `$retry` | `alepha/retry` | Retry with backoff |

**Background work: always reach for `$job`.** It is the only primitive with a
durable outbox — at-least-once delivery, retries, idempotency keys, priorities,
crash recovery via a reconciliation sweep, and failure records in the database.

```ts
import { $job } from "alepha/api/jobs";

class Emails {
  // queue-mode: declare `schema`, then `await this.welcome.push({ ... })`
  welcome = $job({
    schema: z.object({ userId: z.text() }),
    retry: { retries: 3 },
    handler: async ({ payload, attempt }) => { /* ... */ },
  });

  // cron-mode: declare `cron` instead. Never both.
  sweep = $job({ cron: "0 3 * * *", handler: async () => { /* ... */ } });
}
```

`$job` needs a database (it writes to the `jobExecution` table) and registers
an admin controller — that is why it lives under `alepha/api/`. Register
`AlephaApiJobs`; add `AlephaApiJobsQueue` only if you want dispatch to go
through a real broker instead of in-process.

**File uploads: always reach for `$storage`.** Every upload writes a `files`
row next to the blob, which is what makes listing, TTL expiry, tags, checksums
and creator tracking possible.

```ts
import { $storage } from "alepha/api/files";

class Media {
  avatars = $storage({ mimeTypes: ["image/png"], maxSize: 2 }); // maxSize is MB
  scratch = $storage({ ttl: [1, "day"] }); // expires itself

  async save(file: FileLike, user: UserAccountToken) {
    const stored = await this.avatars.upload(file, { user });
    return stored.id; // the `files` row id — use it in your own tables
  }
}
```

`upload()` returns the row, not a blob id. `list()` is a real paginated query.
A storage is a **key prefix inside one bucket** (`{APP_NAME}/{storage}/{fileId}`),
never a cloud bucket of its own — so declaring many is free.

Register `AlephaApiFiles`; it needs a database. For blobs *without* one, inject
`FileStorageProvider` from `alepha/bucket` directly and give up metadata,
expiry, querying and the HTTP endpoints.

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
import { z } from "alepha";
import { $action } from "alepha/server";

class UserController {
  getUser = $action({
    path: "/users/:id",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ id: z.uuid(), email: z.email() }),
    },
    handler: async ({ params }) => this.userRepo.findById(params.id),
  });
}
```

### Entity & Repository
```typescript
import { z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";

export const userEntity = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(),
    email: z.email(),
    createdAt: db.createdAt(),
  }),
});

class UserService {
  users = $repository(userEntity);
}
```

### Page with Loader
```tsx
import { z } from "alepha";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

class AppRouter {
  api = $client<UserController>();

  userDetail = $page({
    path: "/users/:id",
    schema: { params: z.object({ id: z.uuid() }) },
    loader: async ({ params }) => ({
      user: await this.api.getUser({ params })
    }),
    component: ({ user }) => <div>{user.email}</div>,
  });
}
```

### Form
```tsx
import { z } from "alepha";
import { useForm } from "alepha/react/form";

function LoginForm() {
  const form = useForm({
    schema: z.object({
      email: z.email(),
      password: z.text(),
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

## Schema Types (`z`)

Alepha's `z` is a Zod 4 wrapper. Import it from `alepha`, never from `zod`.

```typescript
import { z } from "alepha";

z.string()              // Basic string
z.text()                // String with maxLength, trim, lowercase options
z.email()               // Email validation
z.uuid()                // UUID validation
z.number()              // Number
z.integer()             // Integer
z.boolean()             // Boolean
z.date()                // Date
z.datetime()            // ISO date-time
z.array(z.string())     // Array
z.object({ ... })       // Object
z.enum(["a", "b"])      // Enum
z.literal("value")      // Literal
z.union([...])          // Union
z.record(z.text(), z.any())  // Record

z.string().optional()   // Optional: a method, not z.optional(...)
z.string().nullable()   // Nullable: likewise
```

## Common Mistakes

1. Using decorators → Use primitives (`$action`, not `@Get()`)
2. Importing from `zod` → import `z` from `alepha` (it is a Zod 4 wrapper)
3. Using Express patterns → No `app.get()`, `router.use()`
4. Using `$inject` across modules → Use `$client` instead
5. Using async constructors → Use `$hook({ on: "start" })`
6. Manual instantiation → Let DI container manage
7. Fetching ids, then fetching rows with `inArray` → declare a `$relations` and use `include`

## Source Code

Read implementation at `src/` directory. Check `.spec.ts` files for usage examples.
