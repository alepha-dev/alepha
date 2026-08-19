# Dev Command

Start your development server with a single command. Hot reloading, fast refresh, environment variables - it all just works.

## Quick Start

```bash
alepha dev
```

That's it. Your app is running. Make changes and watch them appear instantly.

## Options

| Flag | Description |
|------|-------------|
| `--only` | Run only specific apps in a monorepo (comma-separated: `--only api,web`) |

## What It Does

The `dev` command runs your app through a Vite dev server:

```bash
alepha dev
# → http://localhost:5173 (the default when no port is configured)
```

### Port

The port is resolved in this order: the `SERVER_PORT` environment variable, then `dev.port` in `alepha.config.ts`, then Vite's `server.port`, then `5173`. The chosen port is bound strictly - a second dev server on the same port fails loudly instead of drifting to `5174`:

```typescript
export default defineConfig({
  dev: { port: 3303 },
});
```

You get:
- **Hot Module Replacement**: Changes appear instantly without full page reload
- **Fast Refresh**: React state preserved during edits
- **SSR in development**: Same rendering behavior as production
- **Source maps**: Debug your actual TypeScript code

Backend-only projects (no browser entry) run through the same Vite server - you still get instant reload on save, without a bundler/watcher setup of your own.

### Workspace Mode

Run `alepha dev` from a workspace root with an `apps/` directory, and it spawns every app in parallel:

```bash
alepha dev
# → api   http://localhost:5173
# → web   http://localhost:5174
```

- Each app gets a port from its position in the `apps/` listing, starting at 5173. Ports are stable: `--only web` keeps `web` on the same port it has when all apps run, so OAuth redirect URIs and client configs stay valid.
- Log lines are prefixed with the app name (via `APP_NAME`).
- `--only api,web` filters which apps start.
- Scoped directories (`apps/@myorg/api`) are supported.

## Entry Point Detection

Alepha looks for your server entry under `src/`, in this order:

1. `src/main.server.ts` (or `.tsx`)
2. `src/main.ts` (or `.tsx`)

The browser entry is optional and resolved the same way: `src/main.browser.ts(x)`, then `src/main.ts(x)`. A stylesheet is picked up from `src/main.css`, `src/styles.css`, or `src/style.css`.

You can override any of these in `alepha.config.ts`:

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  entry: {
    server: "src/server.ts",
    browser: "src/client.ts",
  },
});
```

> **Entry Point Required**
>
> If no server entry is found, the command fails with the list of paths it tried.

## Environment Variables

> **Automatic .env Loading**
>
> The `dev` command automatically loads `.env` files - no extra setup required.

Environment variables from `.env` are available immediately:

```bash filename=.env
DATABASE_URL=postgres://localhost/mydb
API_KEY=secret123
```

These are available in your code via `process.env` or the `$env` primitive:

```typescript check
import { $env, z } from "alepha";

class MyService {
  protected readonly env = $env(z.object({
    DATABASE_URL: z.text(),
    API_KEY: z.text(),
  }));

  connect() {
    console.log(this.env.DATABASE_URL);
  }
}
```

## Vite Integration

Under the hood, the dev server is Vite, fully configured by the Alepha CLI:

- **React Fast Refresh**: Edit components without losing state
- **Server-Side Rendering**: Your pages render on the server during development
- **API Routes**: Define `$action` endpoints that work seamlessly
- **Static Assets**: Import images, fonts, and other assets directly

Your `vite.config.ts` stays minimal because the CLI does the heavy lifting - the file exists so extra Vite plugins (like Tailwind) can hook in, and so Vitest has its `test` block:

```typescript
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss()],
  test: {
    root: ".",
    globals: true,
  },
});
```

## Debugging

### Server-Side Code

Your server code runs in Node.js. Use standard debugging - `--inspect` on the CLI process, or VS Code's debugger with a `launch.json` config.

### Client-Side Code

Open browser DevTools. Your TypeScript source maps are there.

### Logs

Alepha's logger writes to the console during development. Control verbosity with environment variables:

```bash
LOG_LEVEL=debug alepha dev   # More details
LOG_LEVEL=trace alepha dev   # Everything
```

## Auto-Configuration

The first time you run `dev`, Alepha creates a `tsconfig.json` if it's missing. This means you can literally start with just a `src/main.ts` file:

```typescript check
// src/main.ts
import { Alepha } from "alepha";

const alepha = Alepha.create();
await alepha.start();
```

> **Zero Config Start**
>
> You don't need to run `alepha init` first - just start coding. `init` gives you the full scaffold; `dev` only needs an entry file.

## Tips

**Keep the terminal visible.** Errors and logs appear there. It's your feedback loop.

**Trust your IDE.** Let your editor show type errors as you code. When you're done, run `alepha verify` to catch everything at once.

**Trust the hot reload.** If something looks wrong, try a hard refresh (`Cmd+Shift+R`). If that doesn't help, restart the dev server.

**Check network tab.** For API debugging, the browser's network tab shows all requests to your `$action` endpoints.
