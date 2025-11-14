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
npm install alepha
npm install -D @alepha/cli
```

## What is this?

Alepha is an opinionated framework that handles everything from database to frontend.

It uses a descriptor-based architecture (`$action`, `$page`, `$repository`, etc.) and enforces type safety across the entire stack.

For more information, please visit the [documentation](https://feunard.github.io/alepha/).

## Examples

### API endpoint

Write API endpoints with automatic OpenAPI documentation.

```ts
// hello.ts
import { run, t, Alepha } from "alepha";
import { $action } from "alepha/server";
import { $swagger } from "alepha/server/swagger";

class Api {
  docs = $swagger();

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

const alepha = Alepha.create();

alepha.with(Api);

run(alepha);
```

```bash
npx alepha dev hello.ts
```

### React Application

Build full-stack React applications, with server-side rendering (SSR) and client-side rendering (CSR).

```tsx
// app.tsx
import { run, t } from "alepha";
import { $page } from "alepha/react";
import { useState } from "react";

const Hello = (props: { count: number }) => {
  const [ count, setCount ] = useState(props.count);
  return <button onClick={() => setCount(count + 1)}>Clicked: {count}</button>
}

class AppRouter {
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

const alepha = Alepha.create();

alepha.with(AppRouter);

run(alepha);
```
Create an `index.html` file:

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
npx alepha dev
```
