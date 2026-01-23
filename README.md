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
Easy mode for building TypeScript applications.
</p>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/v/alepha.svg" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/l/alepha.svg" alt="npm"/></a>
<a href="https://codecov.io/gh/feunard/alepha"><img src="https://codecov.io/gh/feunard/alepha/graph/badge.svg?token=ZDLWI514CP" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/dt/alepha.svg" alt="npm"/></a>
<a href="https://github.com/feunard/alepha"><img src="https://img.shields.io/github/stars/feunard/alepha.svg?style=social" alt="GitHub stars"/></a>
</div>

## What is this?

A full-stack TypeScript framework for building APIs, React apps with SSR, CLI tools, and more.

- **Runs on Node.js and Bun** — switch runtimes without changing code
- **Zero config** — sensible defaults, override when needed
- **Type-safe everything** — schemas validate at runtime, TypeScript catches the rest
- **Single bundle deploy** — no `node_modules` in production

Check out the [documentation](https://alepha.dev) for the full picture.

## Quick Start

**Requirements:** [Node.js](https://nodejs.org/) v22+ or [Bun](https://bun.sh/)

### API Server

```bash
npx alepha init my-api
cd my-api
```

Edit `src/api/controllers/HelloController.ts`:

```ts
import { t } from "alepha";
import { $action } from "alepha/server";
import { $swagger } from "alepha/server/swagger";

export class HelloController {
  docs = $swagger();

  hello = $action({
    path: "/hello",
    schema: {
      query: t.object({
        name: t.optional(t.text()),
      }),
      response: t.object({
        message: t.text(),
      }),
    },
    handler: ({ query }) => ({
      message: `Hello, ${query.name || "World"}!`,
    }),
  });
}
```

```bash
npm run dev
# Open http://localhost:3000/docs/ for auto-generated API docs
```

Build and run in production:

```bash
npm run build
node dist  # or: bun dist
```

### Full-Stack React

In same directory, re-initialize with React support:

```bash
npx alepha init --react
```

Your `src/main.server.ts` wires everything together:

```ts
import { Alepha, run } from "alepha";
import { ApiModule } from "./api/index.ts";
import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(ApiModule);  // API endpoints
alepha.with(WebModule);  // React pages

run(alepha);
```

Start development server:

```bash
npm run dev
# Open http://localhost:3000/
```

## Learn More

- [Documentation](https://alepha.dev) — guides, concepts, API reference
- [GitHub](https://github.com/feunard/alepha) — source code and issues
