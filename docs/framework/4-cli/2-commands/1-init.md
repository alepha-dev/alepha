# Init Command

Start a new Alepha project in seconds. The `init` command sets up everything you need — configuration files, dependencies, and project structure — so you can focus on building, not configuring.

## Quick Start

```bash
alepha init my-app
cd my-app
alepha dev
```

That's it. You now have a working full-stack Alepha project.

## One Shape, Two Presets

Every Alepha project gets the same structure: an API module, a React web module with SSR, and Tailwind CSS. That part is not configurable, and deliberately so. A single canonical layout means anyone opening an Alepha project — a teammate, a contributor, or an AI assistant — already knows where everything lives. Scaffolding that lets you move the furniture buys a little convenience up front and costs you a code base that looks different in every repository.

A preset does not move the furniture. It decides what is mounted on top of it:

| Preset | What you get |
|---|---|
| `default` | The skeleton. API module, web module, Tailwind. |
| `saas` | The skeleton **plus** the identity surface: `@alepha/ui`, sign-in, an account area and an admin console. |

```bash
alepha init my-app --preset=saas
```

Both produce the same `src/api/`, `src/web/`, `src/main.server.ts` and `src/main.css`. Nothing is renamed or relocated between them, so the "which flags did I pass six months ago?" question has no purchase — you can see the answer by looking at `src/web/index.ts`.

This is the one axis worth branching on because it is the one you cannot easily add later by deleting something. Going the other way is trivial: if you don't need the web module, delete `src/web/`.

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
| `--preset <name>` | Project shape: `default` (the default) or `saas` |
| `--pm <manager>` | Package manager to use: `yarn`, `npm`, `pnpm`, or `bun` |
| `--force`, `-f` | Override existing files |
| `--no-devtools` | Skip `@alepha/devtools` (dev-only, no production bundle cost) |

The first positional argument is the target path:

```bash
alepha init my-app
```

This creates `./my-app/` and scaffolds into it. An absolute path is taken as
given, so `alepha init /tmp/my-app` scaffolds there rather than under the
current directory.

With no argument, `init` picks its target from what the current directory holds:

| Current directory | Result |
|---|---|
| Empty | Scaffolds **in place** — `mkdir my-app && cd my-app && alepha init` does what you expect |
| Has a `package.json` | Fills in whatever is missing, in place |
| Non-empty, no `package.json` | Creates `./my-app/`, so a stray `init` can't scatter files over unrelated work |

Dotfiles don't count towards "empty", so running `git init` first is fine.

## Generated Structure

```txt
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
├── vite.config.ts                   # Tailwind plugin + Vitest config
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

## The `saas` Preset

```bash
alepha init my-app --preset=saas
```

Everything above, plus a working identity surface on first run:

| Route | What's there |
|---|---|
| `/auth/*` | Login, register, password reset, email verification |
| `/account/*` | Profile, security, sessions, API keys, connected apps |
| `/admin/*` | Users, sessions, keys, audit log — and any other console page whose module you mount |

It adds one dependency, `@alepha/ui`, and three files' worth of difference:

```txt
src/
├── api/
│   ├── Realm.ts                     # ← new: $realm + the admin:ui permission
│   └── index.ts                     # + AlephaOrm, AlephaApiUsers
├── web/index.ts                     # + AuthRouter, AccountRouter, AdminRouter
└── main.css                         # @import "@alepha/ui/styles.css"
```

Note what is *not* there: no chrome file, and no changes to `main.server.ts` or `main.browser.ts`. The router options atoms default to `{}`, and their `homeRouteName` / `loginRouteName` defaults already point at the pages this scaffold mounts. Configure them when you want your own branding, not before.

### Your first admin

`src/api/Realm.ts` reads the admin list from the `ADMIN_EMAIL` environment variable via `$env` — and `init` already wrote a gitignored `.env` with the address from `git config user.email`, so a fresh project has a working admin without editing anything. Register with that address and you are promoted to admin, which is what gets you into `/admin`.

Per deployed environment, set `ADMIN_EMAIL` where that environment's variables live (`.env.production`, your platform's dashboard). The address lives in an environment variable rather than the scaffolded source because a committed placeholder address is a real address someone else could register, and the promotion is automatic.

### What's on, and what isn't

`Realm.ts` enables only what the database alone can back — `audits` and `apiKeys`. Everything else (`jobs`, `notifications`, `avatars`, `parameters`, `oauth`) needs a queue, a mailer or a bucket, so it stays off until you have wired the provider.

That is also why `verifyEmailRequired` and `resetPasswordAllowed` are `false`: both can only complete by sending a code, and a realm that asks for either while `notifications` is off is refused at boot. Turn on `notifications`, configure a mail provider, then turn them on.

Admin and account pages follow the same rule automatically. Each one resolves its action against `/api/_links` and hides when it is absent, so turning on a feature makes its screens appear and removing a module takes its screens away — you never get a nav entry pointing at a 404.

### Database

The preset mounts `AlephaOrm`, so `.env.example` carries a `DATABASE_URL` defaulting to a local sqlite file. In development `DATABASE_SYNC` defaults to `true`: your entities are pushed to the database on boot, and there is nothing to generate before the first `alepha dev`.

Before deploying, freeze the schema:

```bash
alepha db migrations create
```

### Not available for Expo

Expo brings its own client runtime, so `init` skips the web module for it — and all three routers are React pages. `--preset=saas` in an Expo project fails rather than quietly scaffolding an API with no UI.

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

- `vite.config.ts` — Carries the `test` block, including the `test.root` that stops a parent monorepo's vitest config taking over. One file, so plugins and aliases can't drift between the build and the tests
- `test/dummy.spec.ts` — A starter test, also a worked example
- a `"test": "alepha test"` script

## Generated Files

### tsconfig.json

A TypeScript configuration tuned for modern development:

- ESNext target and module system
- Bundler module resolution
- Strict mode enabled

### vite.config.ts

Registers the official Tailwind v4 Vite plugin and carries the Vitest `test` block:

```typescript check
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

Everything else about the Vite setup is handled internally by the Alepha CLI — this file exists so Tailwind can hook in and so Vitest has its config (`test.root` stops Vitest walking up into a parent monorepo's config; there is no separate Vitest config file).

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
