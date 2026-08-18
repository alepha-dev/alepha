# Platform Plugin

Deploy your full-stack app to the cloud in one command. The platform plugin provisions databases, storage buckets, queues, pushes secrets, runs migrations, and deploys your code.

## Quick Start

Register the plugin in `alepha.config.ts` with the `platform()` helper:

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  plugins: [
    platform({
      environments: {
        production: { adapter: "cloudflare", domain: "myapp.com" },
      },
    }),
  ],
});
```

```bash
alepha p up
```

Your app is live. Database created, secrets pushed, worker deployed.

## What It Does

Alepha introspects your application at build time. It scans for primitives — `$entity`, `$storage`, `$cache` — plus `$job` dispatch and registered cron jobs, and maps them to cloud resources on the target platform.

The deployment lifecycle runs in a fixed order:

```txt
authenticate → provision → build → migrate → deploy → secrets
```

Each step is handled by an **adapter**. Currently supported adapters are Cloudflare (recommended) and Bay (self-hosted).

Alias: `alepha p` (or `alepha platform`).

## Options

Common flags accepted by most subcommands:

| Flag | Description |
|------|-------------|
| `--env`, `-e` | Target environment (default: `"production"`) |
| `--tenant` | Tenant slug, for apps with `tenancy: "optional"` or `"required"` |
| `--verbose`, `-v` | Enable detailed output |
| `--json` | Machine-readable output |

## Configuration

`platform()` accepts the following options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `package.json` name | Project name. Used as prefix for all resource names. |
| `default` | `string` | `"production"` | Default environment when `--env` is omitted. |
| `tenancy` | `"none" \| "optional" \| "required"` | `"none"` | Multi-tenancy mode — see [Multi-Tenancy](#multi-tenancy). |
| `secrets` | `object` | — | External secret store config — see [the secrets command](#secrets-1). |
| `environments` | `Record` | — | Named environments with adapter and options. |

### Environment Options

| Option | Type | Description |
|--------|------|-------------|
| `adapter` | `string` | Deploy target: `"cloudflare"` (Workers) or `"bay"` |
| `domain` | `string` | Custom domain for the worker. Wildcards (`"*.club.myapp.com"`) are supported for multi-tenant apps and require `zone`. Omit to use the default `*.workers.dev` URL. |
| `zone` | `string` | Cloudflare zone that owns `domain`. Required for wildcard domains; for a plain host it switches the binding from a Custom Domain to a zone route. |
| `host` | `string` | **Bay only, required there.** SSH destination of the Bay server (an ssh alias works). `BAY_HOST` overrides it. |
| `socket` | `string` | **Bay only.** Absolute path of Bay's control socket — required on any host whose Bay root isn't `$HOME/bay-data`. See the [Bay guide](/docs/guides-deployment-bay). |
| `services` | `Array<{ binding, service }>` | Worker-to-worker service bindings, exposed on the runtime `env`. |
| `jurisdiction` | `"eu" \| "fedramp"` | Cloudflare data jurisdiction for R2 buckets and D1 databases. |
| `accountId` | `string` | Cloudflare account ID. Falls back to `CLOUDFLARE_ACCOUNT_ID`, then to the token's account when it is scoped to exactly one. |

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  plugins: [
    platform({
      environments: {
        production: { adapter: "cloudflare", domain: "myapp.com" },
        staging: { adapter: "cloudflare", domain: "staging.myapp.com" },
      },
    }),
  ],
});
```

## Secrets

Runtime secrets are pushed to the cloud provider's secret store during `up`. The key set to push is resolved by precedence:

1. `platform.secrets.keys` — explicit override in `alepha.config.ts`.
2. Otherwise, the union of every key your app declares via `$env` (captured in `dist/manifest.json` at build time) and any keys in `.env.{env}.local`.

Each key's value resolves from `.env.{env}` (then `.env.{env}.local`) first, then `process.env` — so CI can deliver secrets via the job environment with no `.env` file on the runner, while ambient runner variables (`PATH`, `GITHUB_*`, ...) can never leak.

```bash filename=.env.production
STRIPE_SECRET_KEY=sk_live_...
SENDGRID_API_KEY=SG...
```

Variables handled by platform bindings or build config (`DATABASE_URL`, `R2_BUCKET_NAME`, `HYPERDRIVE_ID`, ...), framework infra knobs (`LOG_LEVEL`, `SERVER_PORT`, `DEBUG`, ...), and `VITE_*` variables are filtered out automatically. `PUBLIC_URL` is auto-derived from the configured domain unless you set it explicitly.

## Resource Naming

All cloud resources follow a deterministic naming convention:

```txt
<project>-<env>
```

For a project named `acme` deployed to `production`:

| Resource | Name |
|----------|------|
| Worker | `acme-production` |
| D1 Database | `acme-production` |
| R2 Bucket | `acme-production` |
| KV Namespace | `acme-production` |
| Queue | `acme-production` |

With a tenant (see [Multi-Tenancy](#multi-tenancy)): `<tenant>-<project>-<env>`.

Names are slugified — lowercase, alphanumeric and dashes, max 63 characters.

## Commands

### plan

Preview the deployment topology without touching anything. No authentication required.

```bash
alepha p plan
alepha p plan --env staging
alepha p plan --json
```

Shows: project name, environments, detected resources, resource names, and secret count.

### up

Full deployment pipeline. Runs all six lifecycle steps.

```bash
alepha p up
alepha p up --env staging
```

| Flag | Description |
|------|-------------|
| `--prebuilt` | Skip the Vite bundle steps; only regenerate the deploy config (`wrangler.jsonc`). Use when `dist/` was already produced upstream. |

`--tag` no longer exists — it was removed with the artifact registry. A
programmatic caller of `orchestrator.up({ ... })` still passing `tag` needs to
drop it.

### down

Tear down all resources for an environment. Requires `--env`.

```bash
alepha p down --env staging
```

Prompts for confirmation before deleting. Environments starting with `tmp` skip the confirmation, and `--yes` (`-y`) skips it for non-interactive callers (CI).

### status

Inspect what is currently deployed. Alias: `alepha p s`.

```bash
alepha p status
alepha p status --env staging
alepha p status --json
```

Shows: workers (deployed/not deployed, version, date), databases, buckets, KV namespaces, queues, and secrets (pushed/missing).

### auth

Manage the deploy credential explicitly:

```bash
alepha p auth login    # opens the Wrangler OAuth flow; probes with a real API call
alepha p auth logout
```

`login` is rarely needed — the first `alepha p up` opens the same flow (see [Prerequisites](#prerequisites)) — but it's the command to reach for when you want to switch accounts or verify credentials without deploying.

### build

Build only. No deployment.

```bash
alepha p build --env production
```

### deploy

Deploy only. Assumes already built.

```bash
alepha p deploy --env production
```

### db

Operations against the *deployed* database. They live under `platform` (not core `alepha db`) because they need the environment config, tenancy, adapter, and resource naming.

```bash
# Run database migrations on the deployed database
alepha p db migrate --env production

# Pull the deployed database into a local snapshot (defaults to the dev DB path)
alepha p db export --env production
alepha p db export --output ./snapshot.db --keepSql

# Record the baseline migration as already applied on a deployed D1 database,
# without executing it (D1 only; --reset replaces an existing history)
alepha p db baseline mark --env production
```

#### Placeholder blobs

An export copies rows, not objects. The file table arrives intact while the
blobs it names stay in remote storage, so a local dev server would answer 404
for every image it is asked to serve — once per row.

`db export` therefore writes a stand-in blob for each file row, into the
directory `LocalFileStorageProvider` reads. Images become a grey
`PLACEHOLDER` square in their own format, so they render rather than breaking;
other types get a minimal valid file. Existing blobs are never overwritten, so
anything uploaded locally survives a re-export.

This never runs against production: the files are written by the CLI, to disk,
at export time. Serving a stand-in when a blob is missing would need a
development-only guard, and a guard that fails open would hide real data loss.

```bash
alepha p db export --env production --skipPlaceholders   # leave the blobs missing
```

Placeholders are also skipped when `--output` points somewhere other than the
dev database, since the storage directory only serves the dev server.

### secrets

Sync secrets from `.env.{env}` to an external CI secret store — currently GitHub Actions environments via the `gh` CLI. This is separate from the runtime secrets pushed during `up`. Alias: `alepha p sec`.

```bash
alepha p secrets list           # list remote secret names (--format=gha for a ready-to-paste env: block)
alepha p secrets diff           # compare local .env.{env} keys against the remote store
alepha p secrets apply          # push local secrets (upsert; never deletes) — --dry-run to preview
```

Configure the store in `platform()`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `secrets.store` | `"github"` | — | Secret store backend |
| `secrets.environmentPattern` | `string` | `"{project}-{env}"` | Pattern for resolving environment names in the store |
| `secrets.keys` | `string[]` | auto | Override the worker secret-key allowlist used during `up` |

## Multi-Tenancy

Set `tenancy` to deploy the same app once per tenant:

- **`none`** (default) — single instance; `--tenant` is rejected.
- **`required`** — every deploy needs `--tenant <slug>`; resources are named `<tenant>-<project>-<env>` and the app is served at `<tenant>.<domain>`.
- **`optional`** — a base instance (no `--tenant`) and per-tenant instances coexist.

```typescript
platform({
  tenancy: "required",
  environments: {
    production: { adapter: "cloudflare", domain: "*.club.myapp.com", zone: "myapp.com" },
  },
})
```

```bash
alepha p up --tenant acme      # deploys acme-myproject-production at acme.club.myapp.com
```

Wildcard domains require the `zone` option, and the wildcard DNS record must already exist (proxied) in the Cloudflare zone.

## Cloudflare Adapter

The Cloudflare adapter deploys your application as a [Cloudflare Worker](https://developers.cloudflare.com/workers/). It uses the Cloudflare REST API for resource provisioning and the Wrangler CLI for login, deployment, D1 migrations, and secret management.

### Prerequisites

- A Cloudflare account
- `wrangler` is installed automatically if missing

On first run, `alepha p up` opens the Wrangler OAuth flow in your browser. The token is validated on every run (re-login is triggered automatically if it expired); account resolution is cached for 4 hours. In CI, set `CLOUDFLARE_API_TOKEN` instead.

### Resource Mapping

Alepha detects primitives in your code and maps them to Cloudflare resources:

| Primitive | Cloudflare Resource | Condition |
|-----------|-------------------|-----------|
| `$entity` / `$repository` | D1 (SQLite) | `DATABASE_URL` is absent or not Postgres |
| `$entity` / `$repository` | Hyperdrive | `DATABASE_URL` starts with `postgres:` |
| `$storage` | R2 | Any `$storage` primitive detected |
| `$cache` | KV | Any `$cache` *without* an explicit `provider` (an explicit choice opts out of the platform default) |
| `$job` | Queue | `JobQueueProvider` registered (via `AlephaApiJobsQueue`) — i.e. `$job` dispatch routed through a broker. There is no `$queue` primitive; `alepha/queue` is the transport `$job` sits on, never called directly |
| `$websocket` / `$room` | Durable Objects | Either primitive detected — the `ALEPHA_WEBSOCKET` binding and its migration are written into `wrangler.jsonc` at build time |
| Cron jobs | Cron Triggers | Any cron expression registered (configured at build time, not provisioned) |

D1, Hyperdrive, R2, KV, and Queue are provisioned via the Cloudflare REST API during the `provision` step. Cron triggers are written into `wrangler.jsonc` during the `build` step.

All provisioning is idempotent. If a resource already exists with the expected name, it is reused.

### Database: D1 vs Hyperdrive

The adapter chooses the database strategy based on `DATABASE_URL` in `.env.{env}`:

**D1 (default)** — If no `DATABASE_URL` is set, or it does not start with `postgres:`, the adapter provisions a Cloudflare D1 database (SQLite at the edge). Migrations run via `wrangler d1 migrations apply`.

**Hyperdrive** — If `DATABASE_URL` points to an external PostgreSQL database (`postgres://...`), the adapter provisions a [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) config instead. Hyperdrive accelerates connections from Workers to your Postgres database through connection pooling and caching. Migrations run via `alepha db migrations apply` directly against the database.

```bash
# .env.production — D1 (no DATABASE_URL, or d1:// protocol)
# Nothing to set. D1 is created and wired automatically.

# .env.production — Hyperdrive (external Postgres)
DATABASE_URL=postgres://user:pass@db.neon.tech:5432/mydb
```

### Build

The adapter runs `alepha build -t cloudflare` with environment variables injected from provisioned resources:

| Variable | Set When |
|----------|----------|
| `DATABASE_URL` | D1 provisioned (format: `d1://name:id`) |
| `HYPERDRIVE_ID` | Hyperdrive provisioned |
| `POSTGRES_SCHEMA` | Hyperdrive, when set in `.env.{env}` |
| `R2_BUCKET_NAME` | R2 provisioned |
| `CLOUDFLARE_KV_NAME` | KV provisioned |
| `CLOUDFLARE_KV_ID` | KV provisioned |
| `CLOUDFLARE_QUEUE_NAME` | Queue provisioned |
| `CLOUDFLARE_ANALYTICS_DATASET` | Set by hand — see below |
| `CLOUDFLARE_DOMAIN` | Domain configured |

You do not set these manually — with one exception.

`CLOUDFLARE_ANALYTICS_DATASET` emits an `analytics_engine_datasets` binding
(bound as `ANALYTICS`) and is **not** provisioned by the adapter, because there
is nothing to provision: Cloudflare creates the dataset on the first data point,
so there is no id to pair with the name the way KV and D1 need one. Set it in
`.env.{env}` when the app writes to Workers Analytics Engine.

That binding is **write-only** — `env.ANALYTICS.writeDataPoint({...})`, which
returns nothing and is not awaited. Reading the data back is a different
mechanism entirely: `POST /accounts/{account_id}/analytics_engine/sql` over
plain HTTP with a bearer token scoped *Account · Account Analytics · Read*. Note
that permission is **account-wide** — Cloudflare offers no per-dataset analytics
read scope — so think about where that token lives before putting it in a Worker
that also serves unauthenticated routes.

### Deploy

Deploys via `wrangler deploy` using the generated `dist/wrangler.jsonc`. Returns the live Worker URL.

### Teardown

`alepha p down` deletes resources in dependency order:

1. Queue consumers (unbind from worker)
2. Workers
3. Queues
4. KV namespaces
5. R2 buckets (non-empty buckets are wiped via S3 credentials first when available)
6. D1 databases / Hyperdrive configs

### Full Example

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  plugins: [
    platform({
      environments: {
        production: {
          adapter: "cloudflare",
          domain: "myapp.com",
        },
      },
    }),
  ],
});
```

```bash filename=.env.production
STRIPE_SECRET_KEY=sk_live_...
```

```bash
alepha p up
```

This authenticates with Cloudflare, provisions D1 + R2 + KV + Queue (based on your code), builds for Cloudflare Workers, runs D1 migrations, deploys the worker, and pushes `STRIPE_SECRET_KEY` as a secret.

### Temporary Environments

Prefix an environment name with `tmp` to create a throwaway deployment. Teardown skips the confirmation prompt.

```typescript
environments: {
  production: { adapter: "cloudflare", domain: "myapp.com" },
  staging: { adapter: "cloudflare", domain: "staging.myapp.com" },
  "tmp-pr-42": { adapter: "cloudflare" },
}
```

```bash
alepha p up --env tmp-pr-42
# ... test ...
alepha p down --env tmp-pr-42   # no confirmation
```

## Tips

**Start with `plan`.** Run `alepha p plan` before your first deploy. It shows what will be created without touching anything.

**Use temporary environments for PRs.** Name them `tmp-pr-<number>` and they tear down without confirmation. Great for preview deployments.

**Keep secrets in `.env.production`.** The platform plugin reads them automatically. Don't commit this file.

**Check status after deploy.** Run `alepha p status` to verify everything is live and secrets are pushed.
