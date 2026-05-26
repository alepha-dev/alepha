# Alepha Rocket

Remote `alepha platform` runner, packaged as a Docker image.

Rocket is a thin Alepha app that exposes the `RocketController` from
`@alepha/rocket` over HTTP. Callers hand it a pre-built artifact
(`tar.gz` of the workspace — `src/` + `dist/` + `migrations/` +
`alepha.config.ts` + `package.json`) sitting in an S3-compatible
bucket, plus the target environment, and Rocket runs `alepha platform
<op> --prebuilt --json --env <env>` against Cloudflare on their
behalf.

It is **tenant-unaware** — its vocabulary is `project + environment +
artifact`. The caller (e.g. Alepha Club's platform worker) is
responsible for what those mean.

## Usage

The HTTP surface is generated from `RocketController`. Consume it via
`$container<RocketController>()` (typed proxy, recommended) or raw
HTTP. See `packages/@alepha/rocket/src/core/controllers/RocketController.ts`
for the contract.

Raw HTTP example:

```bash
curl -X POST http://rocket.internal/deploys \
  -H 'Content-Type: application/json' \
  -d '{
    "op": "up",
    "project": "club",
    "env": "production",
    "artifact": {
      "bucket": "alepha-club-builds",
      "key": "apps/club-0.0.2.tar.gz"
    },
    "config": {
      "vars":    { "TENANT_SLUG": "b14", "TENANT_ID": "..." },
      "secrets": { "STRIPE_SECRET_KEY": "sk_..." }
    }
  }'
# → 200 { "id": "...", "status": "queued", ... }

curl http://rocket.internal/deploys/<id>
# → { ..., "status": "succeeded", "deployedUrl": "https://...", "log": "..." }
```

Ops: `up`, `down`, `migrate`, `secrets`. The workspace's
`alepha.config.ts` can read `process.env.<KEY>` for per-tenant
overrides — Rocket writes the request body's `config.vars` +
`config.secrets` into `.env.<env>.local` before spawning the CLI.

## Container environment

| Variable                 | Purpose                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`   | Cloudflare API token (Workers Scripts: Edit + Workers Routes: Edit)        |
| `CLOUDFLARE_ACCOUNT_ID`  | Optional — auto-resolved from the token if omitted                         |
| `S3_ENDPOINT`            | S3-compatible bucket endpoint (e.g. `https://<acct>.r2.cloudflarestorage.com`) |
| `S3_REGION`              | `auto` for R2                                                              |
| `S3_ACCESS_KEY_ID`       | S3 access key                                                              |
| `S3_SECRET_ACCESS_KEY`   | S3 secret                                                                  |
| `PORT`                   | Defaults to `3000`                                                         |
| `ROCKET_DEBUG_RETAIN`    | If set, keep the extracted workspace dir after deploy (post-mortem aid)    |

No `ROCKET_TOKEN` in v1 — Rocket is meant to live behind a Cloudflare
Containers binding (or another internal-network boundary). Adding auth
is a v2 hardening item.

## Build + publish

The Docker image is built and tagged by `alepha build --target=docker`.
A `push` command (defined in `alepha.config.ts`) wraps that with an
optional `docker push`:

```bash
yarn workspace rocket push                 # → alepha/rocket:latest, then push
yarn workspace rocket push --tag 0.21.1    # → alepha/rocket:0.21.1, then push
yarn workspace rocket push --dry-run       # build only (no push)
```

Credentials come from your host's `docker login` session — there's no
CI publish workflow today; the image is pushed from the framework
maintainer's machine.

## Run locally

```bash
docker run --rm -p 3000:3000 \
  -e CLOUDFLARE_API_TOKEN=... \
  -e CLOUDFLARE_ACCOUNT_ID=... \
  -e S3_ENDPOINT=... -e S3_REGION=auto \
  -e S3_ACCESS_KEY_ID=... -e S3_SECRET_ACCESS_KEY=... \
  alepha/rocket:latest
```

## End-to-end smoke test

`test/e2e.sh` runs the full pipeline against your Cloudflare account
using `apps/example-ssr` as the test workload:

1. Builds `apps/example-ssr` (`alepha build -t cloudflare`).
2. Tars the workspace (`src` + `dist` + `alepha.config.ts` + `package.json`).
3. Spins up a local MinIO container (S3-compatible) + the
   `alepha/rocket:latest` image.
4. Uploads the artifact to the MinIO bucket.
5. `POST /deploys op=up`, polls until succeeded, curls the deployed
   worker URL to confirm it responds.
6. `POST /deploys op=down`, polls until succeeded.
7. Tears down both containers.

Requires:

- `docker` daemon running
- `alepha/rocket:latest` built locally
  (`yarn workspace rocket push --dry-run`)
- `jq` on PATH
- `apps/rocket/.env.secrets` (gitignored via the repo's
  `**/.env.*` rule) with at minimum:

  ```
  CLOUDFLARE_API_TOKEN=...
  CLOUDFLARE_ACCOUNT_ID=...   # optional
  ```

Run:

```bash
./apps/rocket/test/e2e.sh
```

The test will create + delete a Cloudflare Worker named
`example-ssr-production`. **Don't run it against an account that has
a real worker with that name** — pick a throwaway/staging account or
rename the test app first.

It is NOT part of `yarn v` — needs real CF credentials and a docker
daemon; the script is run manually when changes to Rocket or
`alepha platform` need a live deploy check.

## Status

- ✅ v1 lib + runner shipped: real S3 fetch, tar.gz extract,
  `alepha platform <op> --prebuilt --json --env <env>` subprocess.
- ✅ Ops: `up`, `down`, `migrate`, `secrets`.
- ✅ `test/e2e.sh` exercises up + down against a real CF account.
- ⏭️  v2: auth (`ROCKET_TOKEN`), parallel deploys, job persistence,
  REST-only deploy path (drops the wrangler dep, unlocks Bun `--compile`).
