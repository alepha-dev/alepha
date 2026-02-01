<div align="center">
<h1>
<img
  src="https://raw.githubusercontent.com/feunard/alepha/main/apps/docs/public/icon-512.png"
  width="128"
  height="128"
  alt="Alepha logo"
  valign="middle"
/>
Alepha
</h1>
<p>TypeScript Framework Made Easy</p>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/v/alepha.svg" alt="npm version"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/l/alepha.svg" alt="license"/></a>
<a href="https://codecov.io/gh/feunard/alepha"><img src="https://codecov.io/gh/feunard/alepha/graph/badge.svg?token=ZDLWI514CP" alt="coverage"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/dt/alepha.svg" alt="downloads"/></a>
</div>

## What is this?

Full-stack TypeScript framework. Node.js and Bun, same code.

You define your API with `$action`, your DB with `$entity`, jobs with `$queue`.
One schema handles database, validation, and TypeScript types.
The client gets full autocomplete without codegen.
Testing? Swap services with `.with()`, no mocking.
Deploy anywhere — Cloudflare, Vercel, Docker, bare metal.

## Example

```tsx
// src/Api.ts
import { t } from "alepha";
import { $action } from "alepha/server";
import { $entity, $repository, db } from "alepha/orm";

const viewEntity = $entity({
  name: "views",
  schema: t.object({
    id: db.primaryKey(),
    createdAt: db.createdAt(),
  }),
});

export class Api {
  views = $repository(viewEntity);

  inc = $action({
    schema: { // ← validates + generates OpenAPI
      response: t.object({
        count: t.number()
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

## Getting Started

Requirements: [Node.js](https://nodejs.org/) 22+ or [Bun](https://bun.sh/) 1.3+

```bash
npx alepha init my-app --api         # API only
npx alepha init my-app --react       # With React
npx alepha init my-app --admin       # Full SaaS starter
npx alepha init my-app --admin --ai  # + AI assistant context

cd my-app && npm run dev
```

## CLI

```bash
alepha dev          # Dev server with HMR
alepha lint         # Format & lint code
alepha typecheck    # TypeScript check
alepha test         # Run tests
alepha build        # Production build
alepha db generate  # Generate migrations
alepha db migrate   # Apply migrations
alepha db studio    # Visual database browser
```

## Learn More

- [Documentation](https://alepha.dev)
- [llms.txt](https://alepha.dev/llms.txt) — for AI assistants
- [GitHub](https://github.com/feunard/alepha)
