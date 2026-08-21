## Overview

`create-alepha` scaffolds a new Alepha project with a single command - it is
the first thing a new user runs:

```bash
npm create alepha my-app
```

Works with any package manager, and the one you invoke is the one your project
gets - `yarn create alepha`, `pnpm create alepha` and `bun create alepha` all
resolve themselves through `npm_config_user_agent`, so there is nothing to
answer.

Pass the name and it runs start to finish without a prompt, which is what a CI
needs. Omit it and an interactive wizard asks for anything missing.

The package is standalone with no runtime dependencies, so `npm create` stays
fast. It scaffolds the same layout as `alepha init`; use `init` from inside an
existing project to fill in missing pieces (it additionally takes `--force`).

## Presets

```bash
npm create alepha my-app --preset saas
```

| Preset    | What you get                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `default` | API module, React web module with SSR, Tailwind                                                                                                  |
| `saas`    | The above plus `@alepha/ui`: sign-in at `/auth/*`, an account area at `/account/*`, an admin console at `/admin/*`, and the `$realm` behind them |

Both presets lay out `src/api/`, `src/web/` and `src/main.css` identically - a
preset decides what is mounted, never where it lives.

## Options

| Flag              | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `--preset <name>` | `default` (the default) or `saas`                        |
| `--pm <manager>`  | Force a package manager: `yarn`, `npm`, `pnpm`, or `bun` |

## After creating

```bash
cd my-app
npm run dev
```
