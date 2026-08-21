# Pack Command

Pack a built workspace into a deployable `tar.gz`. The archive contains everything a remote runner needs to deploy the app with `alepha platform ... --prebuilt` - and nothing else.

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

No source, no `alepha.config.ts`, no `package.json` - the deploy side reads everything it needs from `dist/manifest.json` (detected resources, declared env keys, platform options) and never touches source. Excluded: `node_modules`, `.alepha` build cache, `e2e`, `playwright-report`, `coverage`, and OS junk files.

## Options

| Flag             | Description                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `--tag`, `-t`    | Tag suffix for the artifact name, Docker-style (default: `latest` → `<project>-latest.tar.gz`) |
| `--output`, `-o` | Output directory for the archive (default: current directory)                                  |
| `--name`, `-n`   | Project name for the artifact filename (default: `package.json` `name`)                        |

The project name comes from `package.json` `name`, slugified for the filename (`@acme/app` → `acme-app`).

`--name` is what a deploy passes when the app is known by another name: `platform({ name })` sets the identity the deploy side uses, and it is free to differ from the package name. `alepha platform up` passes it for you, so `pack` writes the file the deploy then looks for. Unlike the `package.json` default it is used verbatim, so it has to be a plain filename: letters, digits, `.`, `_` and `-`.

## Deploying a Packed Artifact

On the consumer side, extract the archive and run the platform commands in prebuilt mode:

```bash
tar -xzf my-app-0.0.2.tar.gz
alepha p up --prebuilt
```

`--prebuilt` skips the Vite bundle steps - only the deploy config (`wrangler.jsonc`) is regenerated from the manifest, so a bare artifact deploys without the app's source tree or its `node_modules`.

This is the workflow external orchestrators (like Alepha Rocket) use: build once, pack once, deploy the same artifact to many environments or tenants.
