# Pack Command

Pack a built workspace into a deployable `tar.gz`. The archive contains everything a remote runner needs to deploy the app with `alepha platform ... --prebuilt` — and nothing else.

## Quick Start

```bash
alepha build --target=cloudflare
alepha pack --tag 0.0.2
# → my-app-0.0.2.tar.gz
```

## What's Inside

```txt
dist/          pre-built output, including manifest.json
migrations/    SQL migration files (if present)
```

No source, no `alepha.config.ts`, no `package.json` — the deploy side reads everything it needs from `dist/manifest.json` (detected resources, declared env keys, platform options) and never touches source. Excluded: `node_modules`, `.alepha` build cache, `e2e`, `playwright-report`, `coverage`, and OS junk files.

## Options

| Flag | Description |
|------|-------------|
| `--tag`, `-t` | Tag suffix for the artifact name, Docker-style (default: `latest` → `<project>-latest.tar.gz`) |
| `--output`, `-o` | Output directory for the archive (default: current directory) |

The project name comes from `package.json` `name`, slugified for the filename (`@acme/app` → `acme-app`).

## Deploying a Packed Artifact

On the consumer side, extract the archive and run the platform commands in prebuilt mode:

```bash
tar -xzf my-app-0.0.2.tar.gz
alepha p up --prebuilt
```

`--prebuilt` skips the Vite bundle steps — only the deploy config (`wrangler.jsonc`) is regenerated from the manifest, so a bare artifact deploys without the app's source tree or its `node_modules`.

This is the workflow external orchestrators (like Alepha Rocket) use: build once, pack once, deploy the same artifact to many environments or tenants.
