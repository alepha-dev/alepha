# create-alepha

Create a new Alepha project with a single command.

## Usage

```bash
npm create alepha my-app
```

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

Pass the name and `--yes` and it runs start to finish without a prompt, which
is what a CI, a Dockerfile or a scripted scaffold needs:

```bash
npm create alepha my-app -- --yes
```

`--yes` answers every remaining question with its default, so the project it
produces is the same one a human gets by pressing Enter. Flags still win over
it, so `--yes --preset saas --no-devtools` is a complete, promptless
description of a different shape. The project name is the one thing `--yes`
cannot supply, because it has no default; leave it out and the command says so
rather than prompting.

Omit `--yes` and an interactive wizard asks for whatever no flag has answered.

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

| Flag              | Description                                                 |
| ----------------- | ----------------------------------------------------------- |
| `--preset <name>` | `default` (the default) or `saas`                           |
| `--pm <manager>`  | Force a package manager: `yarn`, `npm`, `pnpm`, or `bun`    |
| `--no-devtools`   | Skip the devtools question and leave `@alepha/devtools` out |
| `--yes`, `-y`     | Take the default for every remaining question               |

## After creating

```bash
cd my-app
npm run dev
```
