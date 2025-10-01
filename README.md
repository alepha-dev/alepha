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

```ts
import { run } from "alepha";
import { $action } from "alepha/server";

class App {
  hello = $action({
    handler: () => "Hello world!",
  })
}

run(App);
```

👉 For more information, please visit the [documentation](https://feunard.github.io/alepha/).

## Examples

### Type-safe API endpoint

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
        name: t.string()
      }),
      response: t.object({
        message: t.string(),
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

Drizzle ORM is a type-safe ORM for TypeScript, bundled inside Alepha.

Drizzle Kit CLI is required as dev dependencies:

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
    name: t.string(),
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
      })
      this.log.info("Users:", await this.users.find())
    }
  })
}

run(Db)
```

```bash
node app.ts
```

### React SSR Page

Alepha has built-in React CSR & SSR support.

React is required as a dependency:

```bash
npm install react react-dom
npm install -D @types/react
```

```tsx
// app.tsx
import { run, t } from "alepha";
import { $page } from "alepha/react";
import { useState } from "react";

const Hello = (props: { start: number }) => {
  const [ count, setCount ] = useState(props.start);
  return <button onClick={() => setCount(count + 1)}>Clicked: {count}</button>
}

class HomePage {
  index = $page({
    schema: {
      query: t.object({
        s: t.number({ default: 0 }),
      })
    },
    component: Hello,
    resolve: (req) => {
      return { start: req.query.s };
    },
  });
}

run(HomePage);
```

Vite is required as a dev dependency for bundling:

```bash
npm install -D vite
```

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

```html
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

```bash
npx vite
```

## Core Concepts

- **Descriptors**: Define your app logic with `$action`, `$page`, `$repository`, `$cache`, `$email`, etc.
- **Type Safety**: TypeBox schemas validate data from DB to API to frontend
- **DI Container**: Built-in dependency injection using `$inject()`
- **Convention over Config**: Minimal boilerplate, sensible defaults
- **Full-Stack**: React SSR, Vite, class-based router with type-safe routing

Plenty of other features are available, please check the [documentation](https://feunard.github.io/alepha/).

## License

MIT
