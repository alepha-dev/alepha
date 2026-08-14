# create-alepha

Create a new Alepha project with a single command.

## Usage

```bash
npm create alepha my-app
```

Works with any package manager, and the one you invoke is the one your project gets — `yarn create alepha`, `pnpm create alepha` and `bun create alepha` all resolve themselves through `npm_config_user_agent`, so there is nothing to answer.

Pass the name and it runs start to finish without a prompt, which is what a CI needs. Omit it and you are asked for one.

## Presets

```bash
npm create alepha my-app --preset saas
```

| Preset | What you get |
|---|---|
| `default` | API module, React web module with SSR, Tailwind |
| `saas` | The above plus `@alepha/ui`: sign-in at `/auth/*`, an account area at `/account/*`, an admin console at `/admin/*`, and the `$realm` behind them |

Both presets lay out `src/api/`, `src/web/` and `src/main.css` identically — a preset decides what is mounted, never where it lives.

## Options

| Flag | Description |
|------|-------------|
| `--preset <name>` | `default` (the default) or `saas` |
| `--pm <manager>` | Force a package manager: `yarn`, `npm`, `pnpm`, or `bun` |

## After creating

```bash
cd my-app
npm run dev
```

With `--preset saas`, put your email in `adminEmails` in `src/api/Realm.ts` before you register — the first account matching it becomes the admin.

Full documentation: [alepha.dev](https://alepha.dev)
