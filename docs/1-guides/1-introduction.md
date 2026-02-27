# Introduction

Alepha is a full-stack TypeScript application engine.

Most tools require assembling the stack: pick a router, configure an ORM, wire up auth,
set up queues, debug Dockerfiles.

Alepha ships with all of it built-in.

## What is Alepha?

Alepha is an integrated, opinionated, full-stack engine for **Node.js 22+**, **Bun**, and
**Cloudflare Workers**. It automatically selects the right providers (HTTP server, SQL, Redis) based on
the runtime.

It is not a wrapper around Express or Fastify. It is not a React meta-framework like Next.js.
It is a complete full-stack platform: server, database, auth, queues, storage, and frontend -- unified.

Each layer builds on the previous.

| Layer | Description | Primitives                                              |
|-------|-------------|---------------------------------------------------------|
| **Foundation** | DI, lifecycle, config | `$inject`, `$env`, `$module`, `$hook`, `$logger`        |
| **Backend** | Database, queues, storage, API | `$entity`, `$action`, `$queue`, `$bucket`, `$scheduler` |
| **Frontend** | React with SSR, routing, i18n | `$page`, `$head`, `$atom`, `$dictionary`                |
| **Platform** | Users, auth, jobs, audits | `$realm`, `$job`, `$audit`, `$notification`             |
| **Admin** | Admin panel & auth UI | `$ui`, `$uiAdmin`, `$uiAuth`                            |

Not all layers are required. Foundation alone is enough for CLI tools. Add Backend for APIs,
Frontend for web apps, Platform for users and background jobs.

## Why Alepha in 2026?

The way software gets built has changed. AI assistants write large portions of application code.
Edge runtimes have matured. TypeScript is the lingua franca of web development.

Most frameworks were designed before these shifts. They rely on implicit conventions (file-system routing),
sprawling configuration, and glue code between dozens of third-party packages. This creates friction
for both humans and AI tools: the more implicit the rules, the harder it is to generate correct code.

Alepha was designed from scratch for this reality.

### Predictable patterns for AI-assisted development

Every feature in Alepha is expressed through **Primitives** -- explicit `$`-prefixed factory functions
that declare intent directly in your code. There is no hidden magic, no runtime file-system scanning,
no decorator metadata.

An AI assistant reading this code knows exactly what it does:

```typescript
class OrderService {
  orders = $repository(orderEntity);

  create = $action({
    method: "POST",
    path: "/orders",
    schema: {
      body: t.object({ productId: t.uuid(), quantity: t.integer() }),
      response: orderEntity.schema,
    },
    handler: async ({ body }) => this.orders.create(body),
  });
}
```

The schema, the HTTP method, the validation, the return type -- all visible in one place.
No jumping between files, no guessing which middleware runs first.

A machine-readable documentation file is available at [alepha.dev/llms.txt](https://alepha.dev/llms.txt).
AI assistants can consume it to understand the full API surface and generate correct Alepha code.

### Multi-runtime, zero configuration

Alepha detects the runtime at startup and swaps providers automatically. The same code runs on
Node.js, Bun, and Cloudflare Workers without conditional imports or platform-specific build steps.

```typescript filename="src/main.ts"
import { run } from "alepha";
import { $route } from "alepha/server";

class App {
  root = $route({
    path: "/",
    handler: () => "Hello, Alepha!",
  });
}

run(App);
```

`run(App)` handles lifecycle management, signal trapping, and graceful shutdown. There is no
boilerplate to write and nothing to configure.

### One schema, everywhere

The biggest source of bugs in full-stack development is the boundary between layers.
You define a SQL schema, then a Zod schema for the API, then a TypeScript interface for the
frontend. Change one, break the others.

Alepha uses **TypeBox** (imported as `t`) as the single source of truth.

- `$entity` uses the schema to create the database table.
- `$action` uses the same schema to validate the HTTP request and generate OpenAPI docs.
- `$page` uses the same schema to type your React component props.

Data flows from your database to your React component without ever losing its type information or
requiring a manual mapping layer.

## The Primitive Architecture

Alepha does not use decorators (like NestJS) or file-system magic (like Next.js). It uses
**Primitives** -- factory functions starting with `$` that live directly in your class properties.

```typescript
import { t } from "alepha";
import { $action } from "alepha/server";
import { $entity, $repository, db } from "alepha/orm";

const product = $entity({
  name: "products",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    price: t.number(),
    name: t.text(),
  }),
});

class ProductService {
  repo = $repository(product);

  create = $action({
    method: "POST",
    path: "/products",
    schema: {
      body: t.pick(product.schema, ["name", "price"]),
      response: product.schema,
    },
    handler: async ({ body }) => {
      return await this.repo.create(body);
    },
  });
}
```

Each primitive registers itself with the dependency injection container at instantiation time.
The framework discovers your routes, entities, and jobs by reading the primitives on your classes --
not by scanning directories or parsing metadata.

## Infrastructure as Code

Common infrastructure needs are built-in primitives:

| Need | Primitive | What it does |
|------|-----------|--------------|
| Background jobs | `$queue` | Enqueue and process async work |
| File uploads | `$bucket` | Store and retrieve files (S3, R2, Vercel Blob) |
| Cron jobs | `$scheduler` | Run tasks on a schedule |
| Pub/sub | `$topic` | Publish and subscribe to events |
| Caching | `$cache` | Cache expensive computations |
| Distributed locks | `$lock` | Coordinate across processes |
| Email | `$email` | Send transactional email |

Production builds compile to an optimized bundle deployable to Docker, Vercel, Cloudflare, or any VPS.
Primitives like `$scheduler` automatically map to native platform formats (Cloudflare Triggers, Vercel Cron).

## Deployment Targets

`alepha build` produces a self-contained `dist/` folder. The build system supports multiple targets:

```bash
alepha build                         # Default: Node.js
alepha build --target=docker         # Generates Dockerfile
alepha build --target=vercel         # Adapts to Vercel serverless
alepha build --target=cloudflare     # Adapts to Cloudflare Workers
alepha build --target=static         # Static site generation
alepha build --runtime=bun           # Bun runtime
```

You can run the output directly:

```bash
node dist    # Node.js
bun dist     # Bun
```

## What Alepha is Not

- **Not a React meta-framework.** React is one optional layer. Alepha works fine as a pure API server.
- **Not a wrapper around Express/Fastify.** The HTTP server is built-in. There is no Express-style middleware chain to configure.
- **Not a micro-framework.** It ships with ORM, auth, queues, storage, scheduling, and more. You opt in to what you need.
