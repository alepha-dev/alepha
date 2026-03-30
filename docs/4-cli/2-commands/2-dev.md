# Dev Command

Start your development server with a single command. Hot reloading, fast refresh, environment variables — it all just works.

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

The `dev` command is smart about what kind of project you're running:

### Full-Stack App (with alepha/react)

If you have `alepha/react` installed, Alepha knows you're building a web application:

```bash
alepha dev
# → http://localhost:5173
```

You get:
- **Hot Module Replacement** — Changes appear instantly without full page reload
- **Fast Refresh** — React state preserved during edits
- **SSR in development** — Same rendering behavior as production
- **Source maps** — Debug your actual TypeScript code

### Backend Only

No React? Alepha assumes you're building a server, CLI tool, or worker:

```bash
alepha dev
# → Runs your entry file with tsx in watch mode
# → Restarts on file changes
```

You get:
- **Watch mode** — Server restarts when you save
- **Fast compilation** — tsx compiles TypeScript on the fly
- **Environment variables** — Automatically loads `.env` files

### Expo (React Native)

If you have Expo in your dependencies, `dev` hands off to Expo's toolchain:

```bash
alepha dev
# → Runs `expo start`
```

## Entry Point Detection

Alepha looks for your entry file in this order:

1. `src/main.ts`
2. `src/main.server.ts`
3. `src/index.ts`
4. `src/server.ts`

> **Entry Point Required**
>
> If no entry file is found, the command will fail with a helpful error message.

## Environment Variables

> **Automatic .env Loading**
>
> The `dev` command automatically loads `.env` files — no extra setup required.

Environment variables from `.env` are available immediately:

```bash filename=.env
DATABASE_URL=postgres://localhost/mydb
API_KEY=secret123
```

These are available in your code via `process.env` or the `$env` primitive:

```typescript
import { $env, t } from "alepha";

class MyService {
  protected readonly env = $env(t.object({
    DATABASE_URL: t.string(),
    API_KEY: t.string(),
  }));

  connect() {
    console.log(this.env.DATABASE_URL);
  }
}
```

## Vite Integration

Under the hood, full-stack apps use Vite. The Alepha Vite plugin handles:

- **React Fast Refresh** — Edit components without losing state
- **Server-Side Rendering** — Your pages render on the server during development
- **API Routes** — Define `$action` endpoints that work seamlessly
- **Static Assets** — Import images, fonts, and other assets directly

Your `vite.config.ts` is minimal because the plugin does the heavy lifting:

```typescript
import alepha from "@alepha/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [alepha()],
});
```

## Debugging

### Server-Side Code

Your server code runs in Node.js. Use standard debugging:

```bash
# With Node inspector
node --inspect node_modules/.bin/tsx watch src/main.ts

# Or use VS Code's debugger with a launch.json config
```

### Client-Side Code

Open browser DevTools. Your TypeScript source maps are there.

### Logs

Alepha's logger writes to the console during development. Control verbosity with environment variables:

```bash
LOG_LEVEL=debug alepha dev   # More details
LOG_LEVEL=trace alepha dev   # Everything
```

## Auto-Configuration

The first time you run `dev`, Alepha ensures your project has the necessary configuration:

- Creates `tsconfig.json` if missing
- Creates `vite.config.ts` if missing (for web apps)

This means you can literally start with just a `src/main.ts` file:

```typescript
// src/main.ts
import { Alepha } from "alepha";

const alepha = Alepha.create();
await alepha.start();
```

And `alepha dev` will set up everything else.

> **Zero Config Start**
>
> Missing config files are created automatically. You don't need to run `alepha init` first — just start coding.

## Tips

**Keep the terminal visible.** Errors and logs appear there. It's your feedback loop.

**Trust your IDE.** Let your editor show type errors as you code. When you're done, run `alepha verify` to catch everything at once.

**Trust the hot reload.** If something looks wrong, try a hard refresh (`Cmd+Shift+R`). If that doesn't help, restart the dev server.

**Check network tab.** For API debugging, the browser's network tab shows all requests to your `$action` endpoints.
