<div align="center">
<h1>
<img
  src="https://raw.githubusercontent.com/feunard/alepha/main/packages/alepha/assets/logo.svg"
  width="128"
  height="128"
  alt="Alepha logo"
  valign="middle"
/>
Alepha
</h1>
<p>One full-stack TypeScript framework. No glue.</p>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/v/alepha.svg" alt="npm version"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/l/alepha.svg" alt="license"/></a>
<a href="https://codecov.io/gh/feunard/alepha"><img src="https://codecov.io/gh/feunard/alepha/graph/badge.svg?token=ZDLWI514CP" alt="coverage"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/dt/alepha.svg" alt="downloads"/></a>
</div>

## What is Alepha?

Alepha is a full-stack TypeScript framework built for the agentic era.

Everything between your code and the runtime (HTTP server, routing, auth, queues, storage, jobs, SSR) is rewritten clean and integrated for Node, Bun, and Cloudflare Workers. Two load-bearing layers are deliberately *not* reinvented: **React** for UI and **Drizzle** for SQL. No library glue, no config sprawl: one small, consistent surface of typed primitives.

That small surface is the point. AI coding agents (Claude Code, Codex) work best against a narrow, predictable API, so they generate predictable, consistent code you can actually review.

- **One schema, everywhere**: database, API validation, TypeScript types and React forms, all from one definition
- **One surface**: every feature is a typed `$primitive`. No third-party glue to wire up or keep in sync
- **Multi-runtime**: the same code runs on Node, Bun, and Cloudflare Workers
- **Deploy anywhere**: Cloudflare, Vercel, Docker, bare metal

## Architecture

Each layer builds on the previous. Use only what you need.

| Layer          | Description | Primitives                                              |
|----------------|-------------|---------------------------------------------------------|
| **Foundation** | DI, lifecycle, config | `$inject`, `$env`, `$module`, `$hook`, `$logger`        |
| **Backend**    | Database, storage, API | `$entity`, `$relations`, `$repository`, `$action`, `$storage` |
| **Frontend**   | React with SSR, routing, i18n | `$page`, `$head`, `$atom`, `$dictionary`                |
| **Platform**   | Users, auth, jobs, audits | `$realm`, `$job`, `$audit`, `$notification`             |

## Built for agents

Every feature is one typed `$primitive`: no decorators, no file-system magic, no runtime metadata. An agent reading the code sees exactly what it does, in one place.

For UI, Alepha keeps **React** as the coding interface, so agents write standard React components, the most familiar surface in their training data, with no framework-specific dialect to get wrong. For SQL it builds on **Drizzle**, but wraps it completely: you write a typed `$entity`, declare how entities relate with `$relations`, and read them through a `$repository`, never Drizzle itself. Underneath, a relational read compiles to a single statement using whatever each dialect is best at: lateral joins on Postgres, correlated subqueries on SQLite and D1. One is a proven interface agents already know; the other is a proven engine they never have to think about.

The smaller and more consistent the surface, the more reliably an agent generates correct code against it. Point your AI assistant at [`alepha.dev/llms.txt`](https://alepha.dev/llms.txt) for the full machine-readable API.

## Example

Define an API, call it from a React page. Typed end-to-end, no codegen, no glue.

```tsx
// src/Api.ts
import { z } from "alepha";
import { $action } from "alepha/server";
import { $entity, $repository, db } from "alepha/orm";

const viewEntity = $entity({
  name: "views",
  schema: z.object({
    id: db.primaryKey(),
    createdAt: db.createdAt(),
  }),
});

export class Api {
  views = $repository(viewEntity);

  inc = $action({
    schema: { // ← validates + generates OpenAPI
      response: z.object({
        count: z.number()
      })
    },
    handler: async () => {
      await this.views.create({});
      return { count: await this.views.count() };
    },
  });
}
```

```tsx
// src/AppRouter.tsx
import { $client } from "alepha/server/links";
import { $page } from "alepha/react/router";
import type { Api } from "./Api.ts";

export class AppRouter {
  api = $client<Api>();  // ← fully typed, zero codegen

  home = $page({
    loader: () => this.api.inc(),
    component: (props) => <div>Counter: {props.count}</div>,
  });
}
```

The `Api` class is the only contract. `$client<Api>()` derives every call site from it. Change a handler's return type and the page stops compiling.

## Getting Started

Requirements: [Node.js](https://nodejs.org/) 22+ or [Bun](https://bun.sh/) 1.3+

```bash
npx alepha init my-app   # API + React (SSR) + Tailwind
cd my-app && npx alepha dev
```

Every project gets the same structure, with no flavours to choose between.

## Learn More

- [Documentation](https://alepha.dev)
- [llms.txt](https://alepha.dev/llms.txt) for AI assistants
- [GitHub](https://github.com/feunard/alepha)
