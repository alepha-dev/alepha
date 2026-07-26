# Platform Plugin

Deploy your full-stack app to the cloud in one command. The platform plugin provisions databases, storage buckets, queues, pushes secrets, runs migrations, and deploys your code.

## Quick Start

Register the plugin in `alepha.config.ts`:

```typescript filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { AlephaCliPlatform } from "alepha/cli/platform";

export default defineConfig({
  services: [AlephaCliPlatform],
  platform: {
    environments: {
      production: { adapter: "cloudflare", domain: "myapp.com" },
    },
  },
});
```

```bash
alepha p up
```

Your app is live. Database created, secrets pushed, worker deployed.

## What It Does

Alepha introspects your application at build time. It scans for primitives -- `$entity`, `$storage`, `$cache` -- plus registered jobs and cron expressions, and maps them to cloud resources on the target platform.

The deployment lifecycle runs in a fixed order:

```
authenticate → provision → build → migrate → deploy → secrets
```

Each step is handled by an **adapter**. Currently supported adapters are Cloudflare (recommended) and Vercel (experimental).

Alias: `alepha p` (or `alepha platform`).

## Options

| Flag | Description |
|------|-------------|
| `--env`, `-e` | Target environment (default: `"production"`) |
| `--app`, `-a` | Target a specific app in a monorepo |
| `--verbose`, `-v` | Enable detailed output |
| `--json` | Machine-readable output (`plan` and `status` only) |

## Configuration

Add a `platform` section to `alepha.config.ts`:

```typescript
import { defineConfig } from "alepha/cli/config";
import { AlephaCliPlatform } from "alepha/cli/platform";

export default defineConfig({
  services: [AlephaCliPlatform],
  platform: {
    environments: {
      production: {
        adapter: "cloudflare",
        domain: "myapp.com",
      },
      staging: {
        adapter: "cloudflare",
        domain: "staging.myapp.com",
      },
    },
  },
});
```

### Platform Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `package.json` name | Project name. Used as prefix for all resource names. |
| `apps` | `string[]` | -- | Monorepo app paths (e.g. `["apps/api", "apps/web"]`). Omit for standalone. |
| `default` | `string` | `"production"` | Default environment when `--env` is omitted. |
| `environments` | `Record` | -- | Named environments with adapter and optional domain. |

### Environment Options

| Option | Type | Description |
|--------|------|-------------|
| `adapter` | `string` | Cloud provider: `"cloudflare"` or `"vercel"` |
| `domain` | `string` | Primary custom domain |
| `domains` | `Record` | Per-app domain mapping (monorepo) |

## Secrets

Secrets are read from `.env.{env}` files. If you deploy to the `production` environment, create a `.env.production` file:

```bash filename=.env.production
STRIPE_SECRET_KEY=sk_live_...
SENDGRID_API_KEY=SG...
```

Variables that are handled by platform bindings (`DATABASE_URL`, `R2_BUCKET_NAME`, etc.) are filtered out automatically. The rest are pushed to the cloud provider's secret store.

## Resource Naming

All cloud resources follow a deterministic naming convention:

```
<project>-<env>[-<app>]
```

For a project named `acme` deployed to `production`:

| Resource | Name |
|----------|------|
| Worker | `acme-production` |
| D1 Database | `acme-production` |
| R2 Bucket | `acme-production` |
| KV Namespace | `acme-production` |
| Queue | `acme-production` |

In a monorepo with an `api` app: `acme-production-api`.

Names are slugified -- lowercase, alphanumeric and dashes, max 63 characters.

## Commands

### plan

Preview the deployment topology without touching anything. No authentication required.

```bash
alepha p plan
alepha p plan --env staging
alepha p plan --json
```

Shows: project name, mode (standalone/monorepo), environments, detected resources, resource names, and secret count.

### up

Full deployment pipeline. Runs all six lifecycle steps.

```bash
alepha p up
alepha p up --env staging
alepha p up --app api          # monorepo: deploy a single app
```

### down

Tear down all resources for an environment. Requires `--env`.

```bash
alepha p down --env staging
```

Prompts for confirmation before deleting. Environments starting with `tmp` skip the confirmation.

### status

Inspect what is currently deployed. Alias: `alepha p s`.

```bash
alepha p status
alepha p status --env staging
alepha p status --json
```

Shows: workers (deployed/not deployed, version, date), databases, buckets, KV namespaces, queues, and secrets (pushed/missing).

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

### migrate

Run database migrations only.

```bash
alepha p migrate --env production
```

## Cloudflare Adapter

The Cloudflare adapter deploys your application as a [Cloudflare Worker](https://developers.cloudflare.com/workers/). It uses the Cloudflare REST API for resource provisioning and the Wrangler CLI for deployment, migrations, and secret management.

### Prerequisites

- A Cloudflare account
- `wrangler` is installed automatically if missing

On first run, `alepha p up` opens the Wrangler OAuth flow in your browser. Credentials are cached for 4 hours.

### Resource Mapping

Alepha detects primitives in your code and maps them to Cloudflare resources:

| Primitive | Cloudflare Resource | Condition |
|-----------|-------------------|-----------|
| `$entity` / `$repository` | D1 (SQLite) | `DATABASE_URL` is absent or not Postgres |
| `$entity` / `$repository` | Hyperdrive | `DATABASE_URL` starts with `postgres:` |
| `$storage` | R2 | Any `$storage` primitive detected |
| `$cache` | KV | Any `$cache` with non-memory provider |
| `AlephaApiJobsQueue` | Queue | The queue-backed job dispatcher is registered |
| `$job({ cron })` | Cron Triggers | Any cron expression registered (configured at build time, not provisioned) |

D1, Hyperdrive, R2, KV, and Queue are provisioned via the Cloudflare REST API during the `provision` step. Cron triggers are written into `wrangler.jsonc` during the `build` step.

All provisioning is idempotent. If a resource already exists with the expected name, it is reused.

### Database: D1 vs Hyperdrive

The adapter chooses the database strategy based on `DATABASE_URL` in `.env.{env}`:

**D1 (default)** -- If no `DATABASE_URL` is set, or it does not start with `postgres:`, the adapter provisions a Cloudflare D1 database (SQLite at the edge). Migrations run via `wrangler d1 migrations apply`.

**Hyperdrive** -- If `DATABASE_URL` points to an external PostgreSQL database (`postgres://...`), the adapter provisions a [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) config instead. Hyperdrive accelerates connections from Workers to your Postgres database through connection pooling and caching. Migrations run via `alepha db migrations apply` directly against the database.

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
| `R2_BUCKET_NAME` | R2 provisioned |
| `CLOUDFLARE_KV_NAME` | KV provisioned |
| `CLOUDFLARE_KV_ID` | KV provisioned |
| `CLOUDFLARE_QUEUE_NAME` | Queue provisioned |
| `CLOUDFLARE_DOMAIN` | Domain configured |

You do not set these manually. The adapter injects them between provisioning and build.

### Deploy

Deploys via `wrangler deploy` using the generated `dist/wrangler.jsonc`. Returns the live Worker URL.

### Secrets

After deployment, secrets from `.env.{env}` are pushed via `wrangler secret:bulk`. The following keys are excluded (handled by bindings or build config):

- `DATABASE_URL`, `HYPERDRIVE_ID`, `POSTGRES_SCHEMA`
- `R2_BUCKET_NAME`, `CLOUDFLARE_DOMAIN`
- `NODE_ENV`
- Any `VITE_*` variable

### Teardown

`alepha p down` deletes resources in dependency order:

1. Queue consumers (unbind from worker)
2. Workers
3. Queues
4. KV namespaces
5. R2 buckets (fails if not empty -- empty manually)
6. D1 databases / Hyperdrive configs

### Full Example

```typescript filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  platform: {
    environments: {
      production: {
        adapter: "cloudflare",
        domain: "myapp.com",
      },
    },
  },
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

## Monorepo Support

For monorepos, define app paths in the config:

```typescript
export default defineConfig({
  platform: {
    apps: ["apps/api", "apps/web"],
    environments: {
      production: {
        adapter: "cloudflare",
        domains: {
          api: "api.myapp.com",
          web: "myapp.com",
        },
      },
    },
  },
});
```

Each app gets its own Worker, KV namespace, and Queue. Database (D1/Hyperdrive) and R2 bucket are shared across apps.

Deploy a single app:

```bash
alepha p up --env production --app api
```

## Vercel Adapter (experimental)

Deploys to Vercel serverless. Handles project creation, deployment, and environment variable management.

```typescript
environments: {
  production: { adapter: "vercel" },
}
```

Limitations: no resource provisioning (database, storage), no native queue support. Prefer Cloudflare for new projects.

## Tips

**Start with `plan`.** Run `alepha p plan` before your first deploy. It shows what will be created without touching anything.

**Use temporary environments for PRs.** Name them `tmp-pr-<number>` and they tear down without confirmation. Great for preview deployments.

**Keep secrets in `.env.production`.** The platform plugin reads them automatically. Don't commit this file.

**Check status after deploy.** Run `alepha p status` to verify everything is live and secrets are pushed.
