# Alepha Rocket

Remote `alepha platform` runner, packaged as a Docker image.

Rocket is a thin Alepha app that exposes the `RocketController` from
`@alepha/rocket` over HTTP. Callers hand it a pre-built artifact
(`tar.gz` of `dist/` + `migrations/` + `alepha.config.ts`) sitting in an
S3 bucket, plus the target environment, and Rocket runs the deploy
pipeline (`alepha platform up/migrate/secrets`) against Cloudflare on
their behalf.

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
      "hostname": "b14.alepha.club",
      "vars":    { "TENANT_ID": "...", "CLUB_CONFIG_JSON": "{...}" },
      "secrets": { "STRIPE_KEY": "..." }
    }
  }'
# → 200 { "id": "...", "status": "queued", ... }

curl http://rocket.internal/deploys/<id>
# → { ..., "status": "running" | "succeeded" | "failed", "log": "..." }
```

## Container environment

| Variable                | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `CF_API_TOKEN`          | Cloudflare API token (`Workers Scripts: Edit`) |
| `S3_ENDPOINT`           | S3-compatible bucket endpoint                |
| `S3_REGION`             | `auto` for R2                                |
| `S3_ACCESS_KEY_ID`      | S3 access key                                |
| `S3_SECRET_ACCESS_KEY`  | S3 secret                                    |
| `S3_BUCKET`             | Artifact bucket name                         |
| `PORT`                  | Defaults to `3000`                           |

No `ROCKET_TOKEN` in v1 — Rocket is meant to live behind a Cloudflare
Containers binding (or another internal-network boundary). Adding auth
is a v2 hardening item.

## Build + run locally

```bash
yarn workspace rocket build
yarn workspace rocket docker:build         # → alepha/rocket:dev

docker run --rm -p 3000:3000 \
  -e CF_API_TOKEN=... \
  -e S3_ENDPOINT=... -e S3_REGION=auto \
  -e S3_ACCESS_KEY_ID=... -e S3_SECRET_ACCESS_KEY=... \
  -e S3_BUCKET=alepha-club-builds \
  alepha/rocket:dev
```

## Status

- v1 lib + runner scaffolded (this is step 3 of the Rocket bring-up).
- `DeployRunner` is currently a stub — it marks deploys `succeeded`
  without doing real work. The real S3 fetch + tar.gz extract +
  `PlatformOrchestrator.up({ prebuilt: true })` wiring is the next
  follow-up.
- `down` is deferred to v2 (destructive guard work still owed).
