# Getting Started

This guide takes you from zero to a running Alepha server in under five minutes.
No Webpack, no Babel, no ESLint configuration.

## Prerequisites

You need one of the following:

- [Node.js 22+](https://nodejs.org/) (recommended for beginners)
- [Bun 1.1+](https://bun.sh/)

## Create a Project

```bash
npx alepha@latest init my-app
```

This creates a `my-app` directory with:

- `package.json` with Alepha as a dependency
- `tsconfig.json` configured for TypeScript
- `alepha.config.ts` with documented build options
- `biome.json` for formatting and linting
- `src/main.server.ts` as the entry file

Dependencies are installed automatically.

### Init Flags

You can scaffold more structure with flags:

```bash
npx alepha@latest init my-app --api              # Add API module (src/api/)
npx alepha@latest init my-app --api --react      # Add API + React frontend (src/web/)
npx alepha@latest init my-app --api --react --admin  # Full stack with admin panel
npx alepha@latest init my-app --test             # Include Vitest test directory
npx alepha@latest init my-app --pm=bun           # Use Bun as package manager
```

Flag cascading: `--admin` implies `--auth`, which implies `--api` and `--ui`, which implies `--react`.

For this guide, we will start with the simplest possible app.

## Your First Server

After running `init`, enter the project:

```bash
cd my-app
```

Open the entry file. For a minimal project (no flags), it looks like this:

```typescript filename="src/main.server.ts"
import { Alepha, run } from "alepha";

const alepha = Alepha.create();

run(alepha);
```

This starts an empty server. Let us add a route. Replace the file contents with:

```typescript filename="src/main.server.ts"
import { run } from "alepha";
import { $route } from "alepha/server";

class App {
  hello = $route({
    path: "/",
    handler: () => "Hello, Alepha!",
  });
}

run(App);
```

That `$route` call is a **Primitive** -- a factory function that registers an HTTP endpoint
directly on your class. No separate router file, no middleware chain.

`run(App)` creates an Alepha container, registers `App`, starts the server, and handles
signal trapping (SIGINT, SIGTERM) for graceful shutdown.

## Run in Development Mode

```bash
npm run dev
```

You should see:

```
[02:10:43.013] INFO <alepha.core.Alepha>: Starting App...
[02:10:43.013] INFO <alepha.core.Alepha>: App is now ready [0ms]

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

Open [http://localhost:5173](http://localhost:5173) in your browser. You will see "Hello, Alepha!".

Development mode gives you:

1. **Hot Module Replacement (HMR)** -- change code, server updates instantly.
2. **TypeScript support** -- no build step required.
3. **Pretty logs** -- readable, structured output.

## Add a Typed API Endpoint

`$route` is low-level. For real APIs, use `$action` -- it adds schema validation, automatic
OpenAPI documentation, and type-safe client calls.

```typescript filename="src/main.server.ts"
import { t, run, $inject } from "alepha";
import { $action } from "alepha/server";
import { DateTimeProvider } from "alepha/datetime";

class App {
  dateTimeProvider = $inject(DateTimeProvider);

  hello = $action({
    path: "/hello",
    schema: {
      response: t.object({
        message: t.text(),
        serverTime: t.datetime(),
      }),
    },
    handler: () => ({
      message: "Hello from Alepha",
      // consider using `dateTimeProvider.nowISOString()` instead of `new Date().toISOString()`
      // for better testability and consistency across runtimes
      serverTime: this.dateTimeProvider.nowISOString(),
    }),
  });
}

run(App);
```

Key differences from `$route`:

- All `$action` paths are automatically prefixed with `/api`. This endpoint serves at `GET /api/hello`.
- The `schema.response` validates the return value and generates OpenAPI documentation.
- If a `schema.body` is provided, the method defaults to `POST`.
- The response is type-checked at compile time.

Save the file. HMR reloads the server. Visit [http://localhost:5173/api/hello](http://localhost:5173/api/hello).

## Build for Production

When you are ready to deploy:

```bash
npm run build
```

This produces a `dist/` folder with an optimized, self-contained bundle.

Run it locally to verify:

```bash
node dist
```

Or with Bun:

```bash
bun dist
```

App starts up just like in development mode, but without HMR and with better performance.

> In production, default port is 3000 instead of 5173 to avoid conflicts with development servers.
> `SERVER_PORT` environment variable can override this.

### Build Targets

Alepha adapts the build output based on where you deploy:

```bash
npm run build -- --target=docker       # Generates a Dockerfile in dist/
npm run build -- --target=vercel       # Adapts output for Vercel serverless
npm run build -- --target=cloudflare   # Adapts output for Cloudflare Workers
npm run build -- --runtime=bun         # Optimizes for Bun runtime
# or with alepha
npx alepha build
```

Build targets and runtime can also be set in `alepha.config.ts`:

```typescript filename="alepha.config.ts"
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    target: "docker", // will produce a Dockerfile with Node.js base image
    runtime: "node",
  },
});
```

## Project Structure

With `--api` and `--react` flags, `alepha init` scaffolds this structure:

```
my-app/
  alepha.config.ts          # Build and entry point configuration
  package.json
  tsconfig.json
  biome.json
  src/
    main.server.ts          # Server entry point
    main.browser.ts         # Browser entry point (React apps)
    main.css                # Global styles (React apps)
    api/
      index.ts              # API module definition
      controllers/
        HelloController.ts  # Example $action endpoint
      schemas/
        helloResponseSchema.ts
    web/
      index.ts              # Web module definition
      AppRouter.ts          # $page routes
      components/
        Home.tsx            # Example React component
```

Entry file conventions:
- `src/main.ts` -- server-only apps (API)
- `src/main.server.ts` -- server entry when a browser entry also exists
- `src/main.browser.ts` -- browser entry for React apps
