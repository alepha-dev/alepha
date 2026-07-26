# Init Command

Start a new Alepha project in seconds. The `init` command sets up everything you need — configuration files, dependencies, and project structure — so you can focus on building, not configuring.

## Quick Start

```bash
alepha init my-app
cd my-app
alepha dev
```

That's it. You now have a working full-stack Alepha project.

## One Shape, Always

There is nothing to opt into. Every Alepha project gets the same structure: an API module, a React web module with SSR, and Tailwind CSS.

This is deliberate. A single canonical layout means anyone opening an Alepha project — a teammate, a contributor, or an AI assistant — already knows where everything lives. Configurable scaffolding buys a little convenience up front and costs you a code base that looks different in every repository.

If you don't need the web module, delete `src/web/`. That is easier than remembering which flags you passed six months ago.

## What It Does

1. **Creates configuration files** — `tsconfig.json`, `biome.json`, `alepha.config.ts`, `.editorconfig`, `.vscode/settings.json`
2. **Sets up package.json** — Adds Alepha dependencies and standard scripts
3. **Configures your package manager** — Works with Yarn, pnpm, npm, or Bun
4. **Installs dependencies** — Gets everything ready to run
5. **Scaffolds the project** — `src/api/`, `src/web/`, both entry points, and a starter test
6. **Initializes git** — Runs `git init` and writes a `.gitignore` if you're not already in a repo
7. **Writes agent docs** — `AGENTS.md` plus a `CLAUDE.md` that imports it, so coding agents understand the project

## Options

| Flag | Description |
|------|-------------|
| `--pm <manager>` | Package manager to use: `yarn`, `npm`, `pnpm`, or `bun` |
| `--force`, `-f` | Override existing files |
| `--no-devtools` | Skip `@alepha/devtools` (dev-only, no production bundle cost) |

The first positional argument is the target path:

```bash
alepha init my-app
```

This creates `./my-app/` and scaffolds into it. With no argument, `init` works on the current directory — or creates `./my-app/` if the current directory has no `package.json`.

## Generated Structure

```
my-app/
├── src/
│   ├── api/
│   │   ├── controllers/HelloController.ts
│   │   ├── schemas/helloResponseSchema.ts
│   │   └── index.ts                 # ApiModule
│   ├── web/
│   │   ├── components/Home.tsx
│   │   ├── AppRouter.ts
│   │   └── index.ts                 # WebModule
│   ├── main.server.ts               # Server entry
│   ├── main.browser.ts              # Browser entry
│   └── main.css                     # @import "tailwindcss"
├── test/dummy.spec.ts
├── public/favicon.svg
├── alepha.config.ts
├── vite.config.ts                   # Tailwind plugin
├── vitest.config.ts
├── tsconfig.json
├── biome.json
├── .editorconfig
├── .vscode/settings.json
├── AGENTS.md
└── CLAUDE.md                        # @AGENTS.md
```

The router is wired to the API out of the box — `AppRouter.ts` calls `HelloController` through `$client`, giving you an end-to-end type-safe request on the first run.

**Dependencies:** `alepha`, `react`, `react-dom` and, as dev dependencies, `@types/react`, `tailwindcss`, `@tailwindcss/vite`, `@alepha/devtools`.

The toolchain — TypeScript, Vite, Vitest, Biome, drizzle-kit — ships embedded in `alepha` and never appears in your `package.json`. Upgrading `alepha` moves the whole toolchain at once.

## Empty Directory Check

When you name a target path, the directory must be empty (a lone `package.json` is allowed, since that's normal for a workspace package). Use `--force` to scaffold over existing files.

A bare `alepha init` is the fill-in-the-gaps mode and is always safe to run — it only adds missing files and never overwrites without `--force`.

## Package Manager Detection

If you don't specify `--pm`, `init` figures it out automatically, strongest evidence first:

1. A lockfile in the target directory — `yarn.lock`, `pnpm-lock.yaml`, `bun.lock` or `package-lock.json`
2. Inside a workspace → inherits the workspace's package manager
3. How you invoked the CLI → `bunx alepha init` gives you Bun, `pnpm dlx` gives you pnpm, `npx` gives you npm
4. Running under Bun → uses Bun
5. Otherwise → uses npm

Step 3 reads `npm_config_user_agent`, which every package manager sets when it spawns a binary. It ranks below the lockfile and workspace checks on purpose: an existing project has already made this decision, and reaching for `npx` inside a Yarn repo shouldn't switch it to npm.

## Testing

Vitest ships embedded in `alepha`, so `alepha test` works with nothing to install.

- `vitest.config.ts` — Pins `test.root` so a parent monorepo's vitest config doesn't take over
- `test/dummy.spec.ts` — A starter test, also a worked example
- a `"test": "alepha test"` script

## Generated Files

### tsconfig.json

A TypeScript configuration tuned for modern development:

- ESNext target and module system
- Bundler module resolution
- Strict mode enabled

### vite.config.ts

Registers the official Tailwind v4 Vite plugin:

```typescript check
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
});
```

Everything else about the Vite setup is handled internally by the Alepha CLI — this file exists only so Tailwind can hook in.

### biome.json

Linting and formatting rules that make sense:

- Consistent code style across your team
- Import organization
- TypeScript-aware rules
- Fast — Biome is written in Rust

### package.json Scripts

Your package.json gets these scripts:

```json
{
  "scripts": {
    "dev": "alepha dev",
    "build": "alepha build",
    "test": "alepha test",
    "lint": "alepha lint",
    "typecheck": "alepha typecheck",
    "verify": "alepha verify"
  }
}
```

Every script delegates to the `alepha` CLI — there are no raw `tsc` / `vite` / `vitest` / `biome` invocations, because the toolchain is embedded in `alepha`.

## Workspace Awareness

If you run `alepha init` inside a monorepo workspace package (i.e. there's a workspace root above with its own `package.json`), the command adapts:

- Skips workspace-level configs (`tsconfig.json`, `.editorconfig`, `.vscode/settings.json`) if they already exist higher up
- Skips package-manager bootstrapping (the workspace already owns it)
- Skips git init and `AGENTS.md`/`CLAUDE.md` (those belong at the workspace root)
- Skips `@alepha/devtools` (a library has no dev shell for the overlay to attach to)
- Runs install from the workspace root, not the package

## Expo Detection

If your project has Expo in its dependencies, `init` skips the web scaffolding (browser entry, `src/web/`, Tailwind, public assets) — Expo owns that part of the toolchain. The server and API scaffolding still applies.

## Running Init on Existing Projects

Already have a project? Running `alepha init` with no path argument:

- **Won't overwrite** your existing files
- **Adds missing** configuration and structure files
- **Updates** package.json with Alepha dependencies and scripts
- **Installs** any new dependencies

Use `--force` if you want to regenerate files.

## After Init

```bash
# Start developing
alepha dev

# Check your code
alepha lint
alepha typecheck

# Build for production
alepha build

# Run the full verification pipeline
alepha verify
```

## Tips

**Delete what you don't need.** The scaffold is a starting point, not a contract. An API-only service is `alepha init` followed by `rm -rf src/web`.

**Tests are ready from the start.** Write specs in `test/` and run `alepha test`.

**Pick a package manager and stick with it.** Mixing package managers causes headaches. If you're unsure, Yarn or pnpm are solid choices.

**Check the generated files.** The configurations are sensible defaults, but you might want to tweak them. They're yours now.
