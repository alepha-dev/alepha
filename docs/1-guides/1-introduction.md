# Introduction

Alepha is a full-stack TypeScript framework.

Most frameworks require assembling the stack: pick a router, configure an ORM, wire up auth,
set up queues, debug Dockerfiles.

Alepha ships with all of it built-in.

## What is Alepha?

Alepha is an integrated, opinionated, full-stack framework for **Node.js 22+**, **Bun**, and
**Cloudflare Workers**. It automatically selects the right providers (HTTP server, SQL, Redis) based on
the runtime.

It is not a wrapper around Express or Fastify. It is not a React meta-framework like Next.js.
It is a complete full-stack platform: server, database, auth, queues, storage, and frontend — unified.

Each layer builds on the previous.

| Layer | Description | Primitives                                              |
|-------|-------------|---------------------------------------------------------|
| **Foundation** | DI, lifecycle, config | `$inject`, `$env`, `$module`, `$hook`, `$logger`        |
| **Backend** | Database, queues, storage, API | `$entity`, `$action`, `$queue`, `$bucket`, `$scheduler` |
| **Frontend** | React with SSR, routing, i18n | `$page`, `$head`, `$atom`, `$dictionary`                |
| **Platform** | Users, auth, jobs, audits | `$realm`, `$job`, `$audit`, `$notification`             |
| **Admin** | Admin panel & auth UI | `ui`, `uiAuth`, `uiAdmin`                               |

> Not all layers are required. Foundation alone is enough for CLI tools. Add Backend for APIs,
> Frontend for web apps, Platform for users and background jobs.

Other frameworks require assembling these pieces manually. In Alepha, they are built-in primitives.

## The "Primitive" Architecture

Alepha doesn't use decorators (like NestJS) or file-system magic (like Next.js). Instead, it uses
**Primitives** — factory functions starting with `$` that live directly in your class properties.

You define your logic where it belongs: in your code.

```typescript
import { t } from "alepha";
import { $action } from "alepha/server";
import { $entity, $repository, db } from "alepha/orm";

// 1. Define your Database Schema
const product = $entity({
  name: "products",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    price: t.number(),
    name: t.text()
  })
});

class ProductService {
  repo = $repository(product);

  // 2. Define your API Endpoint
  create = $action({
    method: "POST",
    path: "/products",
    schema: {
      body: t.pick(product.schema, ['name', 'price']),
      response: product.schema
    },
    handler: async ({ body }) => {
      // 3. Business Logic
      return await this.repo.create(body);
    }
  });
}
```

This architecture enables:
- **One schema, everywhere** — Database, API validation, and TypeScript types from a single definition.
- **Type-safe RPC** — Browser↔server and server↔server calls, fully typed, no codegen.
- **Auto-generated OpenAPI** — Documentation stays in sync automatically.

## The "Zero-Mapping" Philosophy

The biggest source of bugs in full-stack development is the boundary between the server and the client.

Usually, you define a SQL schema, then a Zod schema for the API, then a TypeScript interface for the
frontend. If you change one, you break the others.

Alepha uses **TypeBox** as a single source of truth.
*   The `$entity` uses the schema to create the database table.
*   The `$action` uses the *same* schema to validate the HTTP request.
*   The React `$page` uses the *same* schema to type your props.

Data flows from your database to your React component without ever losing its type information or
requiring a manual mapping layer.

## Infrastructure as Code (Literally)

Common infrastructure needs are built-in primitives:

- Background jobs → `$queue`
- File uploads → `$bucket`
- Cron jobs → `$scheduler`
- Pub/sub → `$topic`

Production builds compile to an optimized bundle deployable to Vercel, Docker, Cloudflare, or any VPS.
Primitives like `$scheduler` automatically map to native formats (Cloudflare Triggers, Vercel Cron).

## Built for the AI Era

Alepha is designed to work seamlessly with AI coding assistants like Claude Code, Codex, and
GitHub Copilot.

A machine-readable documentation file is available at [alepha.dev/llms.txt](https://alepha.dev/llms.txt).
AI assistants can consume this to understand the framework and generate correct Alepha code.

The opinionated, primitive-based architecture provides clear patterns for AI tools to follow.
