# Init Command

Start a new Alepha project in seconds. The `init` command sets up everything you need — configuration files, dependencies, and project structure — so you can focus on building, not configuring.

## Quick Start

```bash
# In an empty directory
alepha init

# With React support
alepha init --react

# With Tailwind CSS
alepha init --tailwind
```

That's it. You now have a working Alepha project. Run `alepha dev` to start building.

## What It Does

The `init` command is your project bootstrap. It handles the tedious setup work that every project needs:

1. **Creates configuration files** — `tsconfig.json`, `biome.json`, `alepha.config.ts`, `.editorconfig`, `.vscode/settings.json`
2. **Sets up package.json** — Adds Alepha dependencies and standard scripts
3. **Configures your package manager** — Works with Yarn, pnpm, npm, or Bun
4. **Installs dependencies** — Gets everything ready to run
5. **Creates starter files** — Adds `src/main.server.ts` so you have something to work with
6. **Initializes git** — Runs `git init` and writes a `.gitignore` if you're not already in a repo
7. **Drops an agent doc** — Writes `CLAUDE.md` (if the `claude` CLI is installed) or `AGENTS.md` so coding agents understand the project

## Options

| Flag | Description |
|------|-------------|
| `--api` | Include API module structure (`src/api/`) |
| `--react`, `-r` | Include React dependencies and web module (`src/web/`) |
| `--tailwind` | Include Tailwind CSS with the Vite plugin (implies `--react`) |
| `--pm <manager>` | Package manager to use: `yarn`, `npm`, `pnpm`, or `bun` |
| `--force`, `-f` | Override existing files |

You can also pass a path as the first positional argument:

```bash
alepha init my-app --react
```

This creates `./my-app/` and scaffolds into it.

## Flag Cascading

Flags imply each other so you don't have to repeat yourself:

- `--tailwind` → `--react`

So `alepha init --tailwind` is the same as `alepha init --react --tailwind`.

## Empty Directory Check

When any code-generation flag is set (`--api`, `--react`, `--tailwind`), the target directory must be empty (a lone `package.json` is allowed, since that's normal for a workspace package). Use `--force` to overwrite existing files.

`alepha init` with no flags is always safe to run — it only fills in missing config files, never overwrites.

## Package Manager Detection

If you don't specify `--pm`, `init` figures it out automatically:

1. If `yarn.lock` exists → uses Yarn
2. If `pnpm-lock.yaml` exists → uses pnpm
3. If `bun.lock` exists → uses Bun
4. If `package-lock.json` exists → uses npm
5. Inside a workspace → inherits the workspace's package manager
6. Otherwise → uses npm

## Project Flavors

### Backend Only

```bash
alepha init
```

A minimal server-side project. Perfect for APIs, CLI tools, or background workers.

**You get:**
- `src/main.server.ts` — Server entry point
- `tsconfig.json`, `biome.json`, `.editorconfig`, `alepha.config.ts`, `.vscode/settings.json`
- `package.json` with just `alepha` — the toolchain (TypeScript, Vite, Vitest, Biome, drizzle-kit) ships embedded in `alepha`, so it never appears in your `package.json`

### With API Module

```bash
alepha init --api
```

Backend with an example controller scaffolded.

**Additional files:**
- `src/api/index.ts`
- `src/api/controllers/HelloController.ts`
- `src/api/schemas/helloResponseSchema.ts`

### Full-Stack React

```bash
alepha init --react
```

Sets up a full-stack application with server-side rendering.

**Additional files:**
- `src/main.browser.ts` — Browser entry point
- `src/main.css` — Global styles
- `src/web/index.ts`, `src/web/AppRouter.ts`, `src/web/components/Home.tsx`
- `public/favicon.svg`

**Additional dependencies:**
- `react`, `react-dom`, `@types/react`

### With Tailwind CSS

```bash
alepha init --tailwind
```

Everything from `--react`, plus Tailwind v4 wired up via the official Vite plugin.

**Additional files:**
- `vite.config.ts` — Imports `@tailwindcss/vite`
- `src/main.css` — Includes `@import "tailwindcss"`

**Additional dependencies:**
- `tailwindcss`, `@tailwindcss/vite`

### Testing

Every `alepha init` scaffolds a test setup — no flag needed. Vitest ships
embedded in `alepha`, so `alepha test` works out of the box.

**Always created:**
- `vitest.config.ts` — Pins `test.root` so a parent monorepo's vitest config doesn't take over
- `test/dummy.spec.ts` — A starter test, also a worked example
- a `"test": "alepha test"` script

Nothing to install — Vitest is part of `alepha`.

## Generated Files

### tsconfig.json

A TypeScript configuration tuned for modern development:

- ESNext target and module system
- Bundler module resolution
- Strict mode enabled

### vite.config.ts

Only created when `--tailwind` is set:

```typescript check
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
});
```

Without `--tailwind`, Alepha's CLI uses its own internal Vite setup — you don't need a `vite.config.ts` at all.

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
- Skips git init and `CLAUDE.md`/`AGENTS.md` (those belong at the workspace root)
- Runs install from the workspace root, not the package

## Expo Detection

If your project has Expo in its dependencies, `init` skips the React web scaffolding (browser entry, web tree, public assets) — Expo owns that part of the toolchain. The server-side and API scaffolding still applies.

## Running Init on Existing Projects

Already have a project? No problem. Running `alepha init` (no flags) on an existing project:

- **Won't overwrite** your existing files
- **Adds missing** configuration files
- **Updates** package.json with Alepha dependencies and scripts
- **Installs** any new dependencies

Use `--force` if you want to regenerate files. Code-generation flags require an empty directory unless `--force` is set.

## After Init

Once your project is initialized:

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

**Start small.** Begin with `alepha init` (no flags) and add features later. You can always run `init --react` or `init --tailwind --force` on top of an existing project.

**Tests are ready from the start.** Every project is scaffolded with a working Vitest setup — just write specs in `test/` and run `alepha test`.

**Pick a package manager and stick with it.** Mixing package managers causes headaches. If you're unsure, Yarn or pnpm are solid choices.

**Check the generated files.** The configurations are sensible defaults, but you might want to tweak them. They're yours now.
