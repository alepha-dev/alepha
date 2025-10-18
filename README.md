<div align="center">
<h1 >
<img
	src="https://raw.githubusercontent.com/feunard/alepha/main/assets/logo.png"
	width="128"
	height="128"
	alt="Logo"
  valign="middle"
/>
Alepha
</h1>
<p style="max-width: 512px">
</p>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/v/alepha.svg" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/l/alepha.svg" alt="npm"/></a>
<a href="https://codecov.io/gh/feunard/alepha"><img src="https://codecov.io/gh/feunard/alepha/graph/badge.svg?token=ZDLWI514CP" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/dt/alepha.svg" alt="npm"/></a>
<a href="https://github.com/feunard/alepha"><img src="https://img.shields.io/github/stars/feunard/alepha.svg?style=social" alt="GitHub stars"/></a>
</div>

A convention-driven TypeScript framework for building type-safe full-stack applications.

## Quick Start

```bash
npx @alepha/cli create my-app
```

Or manually:

```bash
npm install alepha
```

## What is this?

Alepha is an opinionated framework that handles everything from database to frontend.

It uses a descriptor-based architecture (`$action`, `$page`, `$repository`, etc.) and enforces type safety across the entire stack.

For more information, please visit the [documentation](https://feunard.github.io/alepha/).

## Examples

### Type-safe API endpoint

Write type-safe API endpoints with automatic OpenAPI documentation and more.


```ts
// app.ts
import { run, t } from "alepha";
import { $action } from "alepha/server";
import { $swagger } from "alepha/server/swagger";

class Api {
  docs = $swagger({
    info: {
      title: "My API",
      version: "1.0.0",
    }
  })

  sayHello = $action({
    path: "/hello/:name",
    schema: {
      params: t.object({
        name: t.text()
      }),
      response: t.object({
        message: t.text(),
      })
    },
    handler: async ({ params }) => {
      return { message: `Hello ${params.name} !` };
    }
  });
}

run(Api);
```

```bash
node app.ts
```

### Database with Drizzle ORM

[Drizzle ORM](https://orm.drizzle.team/) is a type-safe ORM for TypeScript, bundled inside Alepha.

You need `drizzle-kit` CLI as dev dependencies:

```bash
npm install -D drizzle-kit
```

```ts
// app.ts
import { $hook, run, t } from "alepha";
import { $entity, $repository, pg } from "alepha/postgres";
import { $logger } from "alepha/logger";

export const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    name: t.text(),
  }),
});


class Db {
  log = $logger();
  users = $repository(users);

  ready = $hook({
    on: "ready",
    handler: async () => {
      await this.users.create({
        name: "John Doe",
      });
      this.log.info("Users:", await this.users.find());
    }
  })
}

run(Db)
```

```bash
node app.ts
```

### React Application

Build full-stack React applications, with server-side rendering (SSR) and client-side rendering (CSR).

[React](https://react.dev) is required as a `dependency`:

```bash
npm install react react-dom
npm install -D @types/react
```

```tsx
// app.tsx
import { run, t } from "alepha";
import { $page } from "alepha/react";
import { useState } from "react";

const Hello = (props: { count: number }) => {
  const [ count, setCount ] = useState(props.count);
  return <button onClick={() => setCount(count + 1)}>Clicked: {count}</button>
}

class HomePage {
  index = $page({
    schema: {
      query: t.object({
        start: t.number({ default: 0 }),
      })
    },
    component: Hello,
    resolve: (req) => {
      return { count: req.query.start };
    },
  });
}

run(HomePage);
```

[Vite](https://vite.dev) is required as a `devDependencies`:

```bash
npm install -D vite
```

Add the Alepha Vite plugin to your Vite config:

```ts
// vite.config.ts
import { viteAlepha } from "alepha/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    viteAlepha()
  ]
});
```

Create an `index.html` file:

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>App</title>
</head>
<body>
<script type="module" src="app.tsx"></script>
</body>
</html>
```

Then run Vite:

```bash
npx vite
```

## License

MIT
