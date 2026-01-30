<div align="center">
<h1 >
<img
	src="https://raw.githubusercontent.com/feunard/alepha/main/apps/docs/public/icon-512.png"
	width="128"
	height="128"
	alt="Logo"
  valign="middle"
/>
Alepha
</h1>
<p style="max-width: 512px">
TypeScript Framework
Made Easy
</p>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/v/alepha.svg" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/l/alepha.svg" alt="npm"/></a>
<a href="https://codecov.io/gh/feunard/alepha"><img src="https://codecov.io/gh/feunard/alepha/graph/badge.svg?token=ZDLWI514CP" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/dt/alepha.svg" alt="npm"/></a>
<a href="https://github.com/feunard/alepha"><img src="https://img.shields.io/github/stars/feunard/alepha.svg?style=social" alt="GitHub stars"/></a>
</div>

```tsx
// src/Api.ts (server)
import { t } from "alepha";
import { $action } from "alepha/server";
import { $entity, $repository, db } from "alepha/orm";

const viewEntity = $entity({
  name: "views",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
  }),
});

export class Api {
  views = $repository(viewEntity);
  inc = $action({
    schema: { response: t.object({ count: t.number() }) },
    handler: async () => {
      await this.views.create({});
      return { count: await this.views.count() };
    },
  });
}

// src/AppRouter.tsx (client & server)
import { $client } from "alepha/server/links";
import { $page } from "alepha/react/router";
import type { Api } from "./Api.ts";

export class AppRouter {
  api = $client<Api>();  // ← type-safe API client, zero codegen
  home = $page({
    loader: () => this.api.inc(),
    component: (props) => <div>Counter: {props.count}</div>,
  });
}
```

## What is this?

API, React SSR, CLI, MCP — one framework, all targets.

Few dependencies. No library shopping. One decision, then build.

Every line can be customized, extended, or replaced.

Dev, build, test, deploy — one tool handles everything.

Schema-driven DSL with compile-time types and runtime validation.

Structured DSL that AI agents actually understand.

For more information, please visit the [documentation](https://alepha.dev).

## Getting Started

**Requirements:** [Node.js](https://nodejs.org/) v22+ or [Bun](https://bun.sh/) v1.3+

```bash
npx alepha init my-app
cd my-app
npm run dev
```

## Pick Your Weapon

```bash
# API backend (REST endpoints, validation, OpenAPI docs)
npx alepha init my-api --api

# React frontend (SSR, routing, code-splitting)
npx alepha init my-app --api --react

# Complete SaaS starter (auth, admin portal, user management)
npx alepha init my-saas --admin

# Using an AI assistant ?
npx alepha init my-saas --admin --ai
```

Each command scaffolds a working project with best practices baked in.

## Production

```bash
# Build for production
alepha build

# Deploy anywhere
alepha build --target=docker      # Containerized
alepha build --target=vercel      # Serverless
alepha build --target=cloudflare  # Edge
```

## Learn More

- [Documentation](https://alepha.dev) - Full guides and API reference
- [GitHub](https://github.com/feunard/alepha) - Source code and examples
- [llms.txt](https://alepha.dev/llms.txt) - For AI assistants
