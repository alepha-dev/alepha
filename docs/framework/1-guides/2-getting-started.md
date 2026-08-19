# Getting Started

This guide takes you from zero to a running Alepha server in under five minutes.
No Webpack, no Babel, no ESLint configuration.

## Prerequisites

You need one of the following:

- [Node.js 22+](https://nodejs.org/) (recommended for beginners)
- [Bun 1.3+](https://bun.sh/)

## Create a Project

```bash
npx alepha@latest init my-app
```

This creates a `my-app` directory with:

- `package.json` with Alepha as a dependency
- `tsconfig.json` configured for TypeScript
- `alepha.config.ts` with documented build options
- `biome.json` for formatting and linting
- `src/api/` with an example controller
- `src/web/` with a React router and page
- `src/main.server.ts` and `src/main.browser.ts` as the entry files
- `AGENTS.md` and `CLAUDE.md` so AI assistants know the project's conventions
- the supporting files: `.gitignore`, `.editorconfig`, `.env.example`,
  `.vscode/` settings, `public/favicon.svg`, and a starter `test/dummy.spec.ts`

Dependencies are installed automatically.

Every Alepha project has this same shape. One layout means anyone opening the
project, human or AI, already knows where things live. If you don't need the
frontend, delete `src/web/`. A [preset](#presets) can add more on top of this
base, but never moves it around.

The flags that change what is scaffolded are `--preset` and `--no-devtools`;
`--pm` (package manager) and `--force` (overwrite existing files) control how:

```bash
npx alepha@latest init my-app --pm=bun
```

## Your First Server

After running `init`, enter the project:

```bash
cd my-app
```

Open the entry file. It wires up the two generated modules:

```typescript filename="src/main.server.ts"
import { Alepha, run } from "alepha";
import { ApiModule } from "./api/index.ts";
import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(ApiModule);
alepha.with(WebModule);

run(alepha);
```

To see the smallest thing Alepha can do, strip it back to a single route. Replace the file contents with:

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

That `$route` call is a **Primitive** - a factory function that registers an HTTP endpoint
directly on your class. No separate router file, no middleware chain.

`run(App)` creates an Alepha container, registers `App`, starts the server, and handles
signal trapping (SIGINT, SIGTERM) for graceful shutdown.

## Run in Development Mode

```bash
npm run dev
```

You should see:

```txt
[02:10:43.013] INFO <alepha.core.Alepha>: Starting App...
[02:10:43.013] INFO <alepha.core.Alepha>: App is now ready [0ms]

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

Open [http://localhost:5173](http://localhost:5173) in your browser. You will see "Hello, Alepha!".

Development mode gives you:

1. **Hot Module Replacement (HMR)**: change code, server updates instantly.
2. **TypeScript support**: no build step required.
3. **Pretty logs**: readable, structured output.

## Add a Typed API Endpoint

`$route` is low-level. For real APIs, use `$action` - it adds schema validation, automatic
OpenAPI documentation, and type-safe client calls.

```typescript filename="src/main.server.ts"
import { z, run, $inject } from "alepha";
import { $action } from "alepha/server";
import { DateTimeProvider } from "alepha/datetime";

class App {
  dateTimeProvider = $inject(DateTimeProvider);

  hello = $action({
    path: "/hello",
    schema: {
      response: z.object({
        message: z.text(),
        serverTime: z.datetime(),
      }),
    },
    handler: () => ({
      message: "Hello from Alepha",
      serverTime: this.dateTimeProvider.nowISOString(),
    }),
  });
}

run(App);
```

Time comes from the injected `DateTimeProvider` rather than `new Date()` so
tests can freeze or travel the clock.

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
npm run build -- --target=cloudflare   # Adapts output for Cloudflare Workers
npm run build -- --runtime=bun         # Optimizes for Bun runtime
# or with alepha
npx alepha build --target=cloudflare
```

Build targets and runtime can also be set in `alepha.config.ts`:

```typescript filename="alepha.config.ts"
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    target: "cloudflare",
    runtime: "workerd",
  },
});
```

## Deploy to the Cloud

Once your app builds, you can deploy it to Cloudflare Workers in one command.

Add the platform plugin to your config:

```typescript filename="alepha.config.ts"
import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  plugins: [
    platform({
      environments: {
        production: { adapter: "cloudflare" },
      },
    }),
  ],
});
```

Then deploy:

```bash
npx alepha p up
```

Alepha scans your code for primitives (`$entity`, `$storage`, `$job`, etc.), provisions the matching Cloudflare resources (D1, R2, Queue), builds for Workers, runs migrations, and deploys - all in one step.

Preview what will be created before deploying:

```bash
npx alepha p plan
```

See the [Platform Plugin](/docs/cli-plugins-platform) guide for full configuration, secrets, monorepo support, and teardown.

## Project Structure

`alepha init` scaffolds this structure, whichever preset you pick:

```txt
my-app/
  alepha.config.ts          # Build and entry point configuration
  package.json
  tsconfig.json
  biome.json
  vite.config.ts            # Tailwind plugin + Vitest config
  src/
    main.server.ts          # Server entry point
    main.browser.ts         # Browser entry point
    main.css                # Global styles (@import "tailwindcss")
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

### Presets

The layout above is fixed. A preset only decides what is mounted on top of it:

```bash
npx alepha init my-app --preset=saas
```

`saas` adds `@alepha/ui` and three routers - sign-in at `/auth/*`, an account
area at `/account/*`, an admin console at `/admin/*` - plus the `$realm` in
`src/api/Realm.ts` that configures them. Nothing moves; you get one extra file
and a longer `src/web/index.ts`.

Full details in the [init command reference](/docs/cli-commands-init).

### Devtools

`alepha init` registers the devtools plugin in `alepha.config.ts` and adds
`@alepha/devtools` to `devDependencies`, so `npm run dev` gives you the inspection
UI straight away - a floating cog at the bottom-left, or `/__devtools/`
directly. It covers atoms, modules, database contents, configuration and logs.

It is dev-only (a Vite plugin that lazy-loads the UI), so it adds nothing to a
production build.

```bash
npx alepha init --no-devtools   # leave it out entirely
```

Workspace packages never get it - a library has no dev server for it to attach
to. To keep the route but drop the floating button, pass
`devtools({ hideButton: true })` in your config. Removing the dependency later
turns the plugin into a no-op with a warning rather than breaking config load.

Building an API-only service? Delete `src/web/`, `src/main.browser.ts` and
`src/main.css`, and drop the `WebModule` line from `main.server.ts`. Expo
projects skip the web scaffolding automatically.

### Entry Points

| File | Purpose |
|------|---------|
| `main.server.ts` | Server entry point |
| `main.browser.ts` | Browser entry point |

### Scaling with Modules

As your project grows, group features into modules:

```txt
src/
  api/
    users/
      controllers/
      services/
      entities/
      index.ts           # UsersModule
    payments/
      controllers/
      services/
      entities/
      index.ts           # PaymentsModule
  web/
    app/
      AppRouter.ts
    components/
  main.server.ts
  main.browser.ts
```

### Naming Conventions

| Directory | Contains | Example files |
|-----------|----------|---------------|
| `controllers/` | API endpoints with `$action` | `UserController.ts` |
| `services/` | Business logic | `UserService.ts` |
| `entities/` | Database schemas with `$entity` | `userEntity.ts` |
| `providers/` | External service wrappers | `StripeProvider.ts` |
| `schemas/` | Shared Zod schemas | `userSchema.ts` |
| `atoms/` | State definitions with `$atom` | `currentUserAtom.ts` |
| `components/` | React components | `UserCard.tsx` |
