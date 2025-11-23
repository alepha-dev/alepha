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
Easy mode for building TypeScript applications.
</p>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/v/alepha.svg" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/l/alepha.svg" alt="npm"/></a>
<a href="https://codecov.io/gh/feunard/alepha"><img src="https://codecov.io/gh/feunard/alepha/graph/badge.svg?token=ZDLWI514CP" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/dt/alepha.svg" alt="npm"/></a>
<a href="https://github.com/feunard/alepha"><img src="https://img.shields.io/github/stars/feunard/alepha.svg?style=social" alt="GitHub stars"/></a>
</div>

## What is this?

Build API endpoints (Docker or Serverless), React applications (SSR, CSR or SSG), and more!

Relies only on very few runtime dependencies. Alepha is a "one decision" framework, meaning you don't have to choose between dozens of libraries and tools.

All-in-one tool that takes care of configuration, development, build, deployment, testing, etc. Convention over configuration.

All features are based on a DSL with strong typing and runtime validation which makes development safe, productive, and AI friendly.

For more information, please visit the [documentation](https://feunard.github.io/alepha/).

## Examples

We will show:

- API endpoint with automatic OpenAPI documentation
- Full-stack React application with server-side rendering

### Requirements

- [Node.js](https://nodejs.org/) v22 or higher

### API endpoint

Write API endpoints with automatic OpenAPI documentation.

```bash
# Add required config files in the current folder
$ npx alepha init
```

Create a new file `src/main.ts`:

```ts
import { run, t, Alepha } from "alepha";
import { $action } from "alepha/server";
import { $swagger } from "alepha/server/swagger";

class Api {

  // Functions starting with $ are "descriptors".
  // Like React hooks, they must be called inside Alepha context.
  docs = $swagger();

  sayHello = $action({
    path: "/hello/:name",
    // Every feature inside Alepha is strongly typed with runtime validation.
    // Schema is based on TypeBox library.
    schema: {
      params: t.object({
        // Alepha provides many built-in types.
        // For example `t.text()` = `t.string()` + specific maxLength, auto-trim, etc.
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

// Creating Alepha instance is like creating a new context.
const alepha = Alepha.create();

// And you add features by registering classes.
alepha.with(Api);

// `run` will take care of Alepha lifecycle (startup, graceful shutdown, etc.)
run(alepha);
```

Run the development server:

```bash
$ npx alepha dev
# alepha dev comes with hot-reload and full TypeScript support, but you can also run:
$ node ./src/main.ts
```

Then, open your browser at `http://localhost:3000/docs/` and enjoy your automatically generated documentation.

#### Production build

Once you are done, build the application for production:

```bash
$ npx alepha build
```

Application will be built in the `dist/` folder, ready to be deployed on any platform (Docker, Serverless, etc.).
Bonus, no need to "npm install" on the server, Alepha bundles everything together.

### React Application

Build full-stack React applications, with server-side rendering.

```bash
$ npx alepha init --react
```

Create a file `src/main.tsx`:

```tsx
import { Alepha, run, t } from "alepha";
import { $page } from "@alepha/react";
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

Run the development server:

```bash
$ npx alepha dev
```

Open your browser at `http://localhost:5173/` and see your React application in action.

## What's next?

- Dive into the [full docs](https://feunard.github.io/alepha/) for more advanced stuff
- Browse the GitHub repo for examples and source code
- Check out the individual packages to see what else you can build
