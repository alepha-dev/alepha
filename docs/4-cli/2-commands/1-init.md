# Init Command

Start a new Alepha project in seconds. The `init` command sets up everything you need — configuration files, dependencies, and project structure — so you can focus on building, not configuring.

## Quick Start

```bash
# In an empty directory
alepha init

# With React support
alepha init --react

# With the full UI kit
alepha init --ui
```

That's it. You now have a working Alepha project. Run `alepha dev` to start building.

## What It Does

The `init` command is your project bootstrap. It handles the tedious setup work that every project needs:

1. **Creates configuration files** — `tsconfig.json`, `biome.json`, `vite.config.ts`, `.editorconfig`
2. **Sets up package.json** — Adds Alepha dependencies and standard scripts
3. **Configures your package manager** — Works with Yarn, pnpm, npm, or Bun
4. **Installs dependencies** — Gets everything ready to run
5. **Creates starter files** — Adds `src/main.ts` so you have something to work with

## Options

| Flag | Description |
|------|-------------|
| `--react` | Include React and alepha/react for building web apps |
| `--ui` | Include @alepha/ui component library (automatically includes --react) |
| `--test` | Set up Vitest and create a test directory |
| `--yarn` | Use Yarn as the package manager |
| `--pnpm` | Use pnpm as the package manager |
| `--npm` | Use npm as the package manager |
| `--bun` | Use Bun as the package manager |

## Package Manager Detection

If you don't specify a package manager, `init` figures it out automatically:

1. If `yarn.lock` exists → uses Yarn
2. If `pnpm-lock.yaml` exists → uses pnpm
3. Otherwise → uses npm

> **Package Manager Cleanup**
>
> When switching package managers, `init` cleans up the old lock files to avoid conflicts.

## Project Flavors

### Backend Only

```bash
alepha init
```

Creates a minimal server-side project. Perfect for APIs, CLI tools, or background workers.

**You get:**
- `src/main.ts` — Your entry point
- `tsconfig.json` — TypeScript configuration
- `vite.config.ts` — Build configuration
- `biome.json` — Linting and formatting rules

### Full-Stack React

```bash
alepha init --react
```

Sets up a full-stack application with server-side rendering.

**Additional files:**
- `src/main.browser.ts` — Browser entry point
- `src/main.server.ts` — Server entry point
- `src/AppRouter.ts` — Your route definitions

**Additional dependencies:**
- `alepha/react` — SSR React integration
- `react` and `react-dom` — React itself
- `@types/react` — TypeScript definitions

### With UI Components

```bash
alepha init --ui
```

Everything from `--react`, plus the Alepha UI component library.

**Additional dependencies:**
- `@alepha/ui` — Pre-built components (buttons, forms, modals, etc.)

### With Testing

```bash
alepha init --test
```

Sets up Vitest for testing your code.

**Additional files:**
- `test/dummy.spec.ts` — A starter test file

**Additional dependencies:**
- `vitest` — Fast, Vite-native test runner

You can combine flags:

```bash
alepha init --react --test
```

## Generated Files

### tsconfig.json

A TypeScript configuration tuned for modern development:

- ESNext target and module system
- Bundler module resolution
- Strict mode enabled
- Path aliases configured

### vite.config.ts

A minimal Vite configuration that just works:

```typescript
import alepha from "@alepha/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [alepha()],
});
```

The Alepha Vite plugin handles React, SSR, and production builds automatically.

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
    "lint": "alepha lint",
    "typecheck": "alepha typecheck",
    "verify": "alepha verify"
  }
}
```

## Expo Projects

If your project has Expo installed, `init` adapts automatically:

- Skips `vite.config.ts` (Expo has its own bundler)
- Works with Expo's toolchain

> **Expo Detection**
>
> Expo detection is automatic — if `expo` is in your dependencies, Alepha knows.

## Running Init on Existing Projects

Already have a project? No problem. Running `init` on an existing project:

- **Won't overwrite** your existing files (except for merging package.json)
- **Adds missing** configuration files
- **Updates** package.json with Alepha dependencies and scripts
- **Installs** any new dependencies

> **Safe to Re-run**
>
> It's safe to run `init` multiple times. Use it when you want to add React to an existing backend project, or when you need to regenerate configuration files.

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

**Start small.** Begin with `alepha init` (no flags) and add React later if you need it. You can always run `init --react` on an existing project.

**Use --test from the start.** Tests are easier to write when you start early. The `--test` flag gives you a working test setup immediately.

**Pick a package manager and stick with it.** Mixing package managers causes headaches. If you're unsure, Yarn or pnpm are solid choices for their speed and reliability.

**Check the generated files.** The configurations are sensible defaults, but you might want to tweak them. They're yours now.
