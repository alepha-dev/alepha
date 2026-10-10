# Infra Plugin

Deploy your full-stack app to the cloud in one command. The infra plugin provisions databases, storage buckets, queues, pushes secrets, runs migrations, and deploys your code.

## Quick Start

Register the plugin in `alepha.config.ts` with the `infra()` helper:

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { cloudflare, infra } from "alepha/cli/infra";

export default defineConfig({
  plugins: [
    infra({
      environments: {
        production: cloudflare({ domain: "myapp.com" }),
      },
    }),
  ],
});
```

```bash
alepha deploy
```

Your app is live. Database created, secrets pushed, worker deployed.

## What It Does

Alepha introspects your application at build time. It scans for primitives - `$entity`, `$storage`, `$cache` - plus `$job` dispatch and registered cron jobs, and maps them to cloud resources on the target platform.

The deployment lifecycle runs in a fixed order:

```txt
authenticate → provision → build → migrate → deploy → secrets
```

Each step is handled by an **adapter**, and an environment names its adapter by calling the adapter's factory: `cloudflare()` (Workers, recommended) and `bay()` (self-hosted) ship with `alepha/cli/infra`. There is no list of adapter names to extend: an adapter is an import, so [writing your own](#writing-an-adapter) needs nothing from the framework.

`alepha infra` shows help without loading configuration. The commands are discoverable without a plugin; config-dependent operations require a nonempty explicit environment map. The former command roots are removed, with no aliases.

## Options

Common flags accepted by most subcommands:

| Flag              | Description                                  |
| ----------------- | -------------------------------------------- |
| `--env`, `-e`     | Target environment (default: `"production"`) |
| `--verbose`, `-v` | Enable detailed output                       |
| `--json`          | Machine-readable output                      |

## Configuration

Environment names are arbitrary explicit keys. The default is `production`; a project using only `prod` must set `default: "prod"`. Files `.env.<env>` and `.env.<env>.local` follow the selected key. No implicit environment or provider is created.

`infra()` accepts the following options:

| Option         | Type     | Default             | Description                                                                                          |
| -------------- | -------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| `name`         | `string` | `package.json` name | The **app** name: one workspace is one app. Used as the prefix of every resource name.               |
| `project`      | `string` | -                   | The project the app belongs to. Set, it goes in front of the app name: `<project>-<app>-<env>`.      |
| `default`      | `string` | `"production"`      | Default environment when `--env` is omitted.                                                         |
| `secrets`      | `object` | -                   | The secret key set override (`keys`), and an external store - see [the secrets command](#secrets-1). |
| `environments` | `Record` | -                   | Named environments, each the result of an adapter factory: `cloudflare(...)`, `bay(...)`.            |

`--env` can only name a key of `environments`: anything else is refused before an adapter runs. Each environment's options are validated against its adapter's own schema when it is resolved, and a bad one is refused by environment name.

### `cloudflare()`

From `alepha/cli/infra`. Node only.

| Option         | Type                          | Description                                                                                                                 |
| -------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `domain`       | `string`                      | Custom domain, attached as a Cloudflare Custom Domain. A plain host: a wildcard is refused. Omit to use `*.workers.dev`.    |
| `services`     | `Array<{ binding, service }>` | Worker-to-worker service bindings, exposed on the runtime `env`.                                                            |
| `jurisdiction` | `"eu" \| "fedramp"`           | Cloudflare data jurisdiction for R2 buckets and D1 databases.                                                               |
| `accountId`    | `string`                      | Cloudflare account ID. Falls back to `CLOUDFLARE_ACCOUNT_ID`, then to the token's account when it is scoped to exactly one. |

### `bay()`

From `alepha/cli/infra`. Node only.

| Option   | Type     | Description                                                                                                                                           |
| -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host`   | `string` | **Required**, here or through `BAY_HOST`. SSH destination of the Bay server (an ssh alias works). `BAY_HOST` overrides it.                            |
| `domain` | `string` | Domain Bay registers for the app, which answers ACME for it. A plain host.                                                                            |
| `socket` | `string` | Absolute path of Bay's control socket - required on any host whose Bay root isn't `$HOME/bay-data`. See the [Bay guide](/docs/guides-deployment-bay). |

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { bay, cloudflare, infra } from "alepha/cli/infra";

export default defineConfig({
  plugins: [
    infra({
      name: "myapp",
      environments: {
        production: cloudflare({ domain: "myapp.com", jurisdiction: "eu" }),
        staging: cloudflare({ domain: "staging.myapp.com" }),
        edge: bay({ host: "deploy@bay.example.com" }),
      },
    }),
  ],
});
```

Settings shared by several environments repeat per environment; a plain `const` holding them is the way to share them.

## Secrets

Runtime secrets are pushed to the cloud provider's secret store during `alepha deploy`. The key set to push is resolved by precedence:

1. `infra().secrets.keys`: explicit override in `alepha.config.ts`.
2. Otherwise, the union of every key your app declares via `$env` (captured in `dist/manifest.json` at build time) and any keys in `.env.{env}.local`. If no readable manifest is available, the base env file supplies the allowlist instead; it is not unioned when the manifest exists.

Each key's value resolves from `.env.{env}` (then `.env.{env}.local`) first, then `process.env` - so CI can deliver secrets via the job environment with no `.env` file on the runner, while ambient runner variables (`PATH`, `GITHUB_*`, ...) can never leak.

```bash filename=.env.production
STRIPE_SECRET_KEY=sk_live_...
SENDGRID_API_KEY=SG...
```

Variables handled by platform bindings or build config (`DATABASE_URL`, `R2_BUCKET_NAME`, `HYPERDRIVE_ID`, ...), framework infra knobs (`LOG_LEVEL`, `SERVER_PORT`, `DEBUG`, ...), and `VITE_*` variables are filtered out automatically. `PUBLIC_URL` is defaulted at config import only in production mode, from the `production` key's domain, unless already set. This is independent of `--env` and of the configured default: set other environments' URLs explicitly.

## Resource Naming

All cloud resources follow a deterministic naming convention:

```txt
<app>-<env>
<project>-<app>-<env>   (with infra({ project }))
```

For an app named `acme` deployed to `production`:

| Resource     | Name              |
| ------------ | ----------------- |
| Worker       | `acme-production` |
| D1 Database  | `acme-production` |
| R2 Bucket    | `acme-production` |
| KV Namespace | `acme-production` |
| Queue        | `acme-production` |

Names are slugified - lowercase, alphanumeric and dashes, max 63 characters.

When several apps share one Cloudflare account, `project` keeps their names apart. With `infra({ project: "alepha", name: "docs" })`, the Worker is `alepha-docs-production`. It only prefixes names; nothing else reads it.

⚠️ Adding or removing `project` renames every resource of the app. The next `alepha deploy` provisions fresh ones under the new names, an empty database included, and leaves the old ones in place. Read `alepha infra plan` before the first `alepha deploy` after the change.

## Commands

### plan

Preview the deployment topology without touching anything. No authentication required.

```bash
alepha infra plan
alepha infra plan --env staging
alepha infra plan --json
```

Shows: project name, environments, detected resources, resource names, and secret count.

### deploy (full lifecycle)

Full deployment pipeline. Runs all six lifecycle steps.

```bash
alepha deploy
alepha deploy --env staging
```

| Flag         | Description                                                                                                                                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--prebuilt` | Skip the Vite bundle steps; still call the adapter build step to refresh deployment configuration/bindings. Use when `dist/` was already produced upstream. Authentication, provisioning, migration, deployment and secret handling still run; this is not granular `infra deploy`. |

`--tag` no longer exists - it was removed with the artifact registry. A
programmatic caller of `orchestrator.up({ ... })` still passing `tag` needs to
drop it.

### down

Tear down all resources for an environment. Requires `--env`.

```bash
alepha infra down --env staging
```

Prompts for confirmation before deleting. Environments starting with `tmp` skip the confirmation, and `--yes` (`-y`) skips it for non-interactive callers (CI).

### status

Inspect what is currently deployed. Alias: `alepha infra s`.

```bash
alepha infra status
alepha infra status --env staging
alepha infra status --json
```

Shows: workers (deployed/not deployed, version, date), databases, buckets, KV namespaces, queues, and secrets (pushed/missing).

### login / logout

Manage the deploy credential explicitly:

```bash
alepha infra login --env production    # opens the Wrangler OAuth flow; probes with a real API call
alepha infra logout --env production
```

Cloudflare `login` is rarely needed - the first `alepha deploy` opens the same flow (see [Prerequisites](#prerequisites)) - but it's the command to reach for when you want to switch accounts or verify credentials without deploying.

Bay login probes SSH and control-socket access; logout refuses because it stores no token. External adapters define their own policy. Login and logout require an explicit `--env`.

### build

Calls the configured adapter's build step only. Cloudflare may query existing resource bindings and needs suitable credentials for those lookups. It does not provision missing resources. For a credential-free Worker artifact, use `alepha build --runtime workerd` instead.

```bash
alepha infra build --env production
```

### infra deploy (granular)

Authenticates, then calls the adapter's deploy step only. It skips the CLI's separate provision, build, migrate and secrets steps. Cloudflare requires a readable `dist/manifest.json` with a workerd slice, the generated Worker entry and `dist/wrangler.jsonc`. Bay requires a readable manifest with a Node entry or a static public directory. Missing or unsuitable artifacts fail before transport with build/full-deploy guidance. External adapters can use source context and are not forced to have local `dist/`.

This is a boundary on local orchestration, not remote behavior: Bay still packs/uploads and its host provisions resources and runs startup migrations. An external Lore adapter may still invoke remote latest-build and secret attachment behavior. Those policies are unchanged.

```bash
alepha infra deploy --env production
```

### db

Operations against the _deployed_ database. They live under `infra` (not core `alepha db`) because they need the environment config, adapter, and resource naming.

```bash
# Run database migrations on the deployed database
alepha infra db migrate --env production

# Pull the deployed database into a local snapshot (defaults to the dev DB path)
alepha infra db export --env production
alepha infra db export --output ./snapshot.db --keepSql

# Record the baseline migration as already applied on a deployed D1 database,
# without executing it (D1 only; --reset replaces an existing history)
alepha infra db baseline mark --env production
```

#### Placeholder blobs

An export copies rows, not objects. The file table arrives intact while the
blobs it names stay in remote storage, so a local dev server would answer 404
for every image it is asked to serve - once per row.

`db export` therefore writes a stand-in blob for each file row, into the
directory `LocalFileStorageProvider` reads. Images become a grey
`PLACEHOLDER` square in their own format, so they render rather than breaking;
other types get a minimal valid file. Existing blobs are never overwritten, so
anything uploaded locally survives a re-export.

This never runs against production: the files are written by the CLI, to disk,
at export time. Serving a stand-in when a blob is missing would need a
development-only guard, and a guard that fails open would hide real data loss.

```bash
alepha infra db export --env production --skipPlaceholders   # leave the blobs missing
```

Placeholders are also skipped when `--output` points somewhere other than the
dev database, since the storage directory only serves the dev server.

### secrets

Sync secrets from `.env.{env}` to an external CI secret store - currently GitHub Actions environments via the `gh` CLI. This is separate from the runtime secrets pushed during `alepha deploy`. Alias: `alepha infra sec`.

```bash
alepha infra secrets list           # list remote secret names (--format=gha for a ready-to-paste env: block)
alepha infra secrets diff           # compare local .env.{env} keys against the remote store
alepha infra secrets apply          # push local secrets (upsert; never deletes) - --dry-run to preview
```

Configure the store in `infra()`:

| Option                       | Type       | Default             | Description                                                          |
| ---------------------------- | ---------- | ------------------- | -------------------------------------------------------------------- |
| `secrets.store`              | `"github"` | -                   | Secret store backend                                                 |
| `secrets.environmentPattern` | `string`   | `"{project}-{env}"` | Pattern for resolving environment names in the store                 |
| `secrets.keys`               | `string[]` | auto                | Override the worker secret-key allowlist used during `alepha deploy` |

## Cloudflare Adapter

The Cloudflare adapter deploys your application as a [Cloudflare Worker](https://developers.cloudflare.com/workers/). It uses the Cloudflare REST API for resource provisioning and the Wrangler CLI for login, deployment, D1 migrations, and secret management.

### Prerequisites

- A Cloudflare account
- `wrangler` is installed automatically if missing

On first run, `alepha deploy` opens the Wrangler OAuth flow in your browser. The token is validated on every run (re-login is triggered automatically if it expired); account resolution is cached for 4 hours. In CI, set `CLOUDFLARE_API_TOKEN` instead.

### Resource Mapping

Alepha detects primitives in your code and maps them to Cloudflare resources:

| Primitive                 | Cloudflare Resource | Condition                                                                                                                                                                                                      |
| ------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$entity` / `$repository` | D1 (SQLite)         | `DATABASE_URL` is absent or not Postgres                                                                                                                                                                       |
| `$entity` / `$repository` | Hyperdrive          | `DATABASE_URL` starts with `postgres:`                                                                                                                                                                         |
| `$storage`                | R2                  | Any `$storage` primitive detected                                                                                                                                                                              |
| `$cache`                  | KV                  | Any `$cache` _without_ an explicit `provider` (an explicit choice opts out of the platform default)                                                                                                            |
| `$job`                    | Queue               | `JobQueueProvider` registered (via `AlephaApiJobsQueue`) - i.e. `$job` dispatch routed through a broker. There is no `$queue` primitive; `alepha/queue` is the transport `$job` sits on, never called directly |
| `$websocket` / `$room`    | Durable Objects     | Either primitive detected - the `ALEPHA_WEBSOCKET` binding and its migration are written into `wrangler.jsonc` at build time                                                                                   |
| `$analytics`              | Analytics Engine    | Any `$analytics` primitive detected - the dataset binding (`ANALYTICS`) is named `<project>-<env>` unless `CLOUDFLARE_ANALYTICS_DATASET` is set in `.env.{env}`                                                |
| Cron jobs                 | Cron Triggers       | Any cron expression registered (configured at build time, not provisioned)                                                                                                                                     |

D1, Hyperdrive, R2, KV, and Queue are provisioned via the Cloudflare REST API during the `provision` step. Cron triggers are written into `wrangler.jsonc` during the `build` step.

All provisioning is idempotent. If a resource already exists with the expected name, it is reused.

### Database: D1 vs Hyperdrive

The adapter chooses the database strategy based on `DATABASE_URL` in `.env.{env}`:

**D1 (default)** - If no `DATABASE_URL` is set, or it does not start with `postgres:`, the adapter provisions a Cloudflare D1 database (SQLite at the edge). Migrations are applied file by file with `wrangler d1 execute --file`, never `wrangler d1 migrations apply`, whose transaction wrapper cascade-deletes child rows on a table rebuild (see the Migrations guide).

**Hyperdrive** - If `DATABASE_URL` points to an external PostgreSQL database (`postgres://...`), the adapter provisions a [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) config instead. Hyperdrive accelerates connections from Workers to your Postgres database through connection pooling and caching. Migrations run via `alepha db migrations apply` directly against the database.

```bash
# .env.production: D1 (no DATABASE_URL, or d1:// protocol)
# Nothing to set. D1 is created and wired automatically.

# .env.production: Hyperdrive (external Postgres)
DATABASE_URL=postgres://user:pass@db.neon.tech:5432/mydb
```

### Build

The adapter runs `alepha build --runtime workerd` with environment variables injected from provisioned resources:

| Variable                       | Set When                                   |
| ------------------------------ | ------------------------------------------ |
| `DATABASE_URL`                 | D1 provisioned (format: `d1://name:id`)    |
| `HYPERDRIVE_ID`                | Hyperdrive provisioned                     |
| `POSTGRES_SCHEMA`              | Hyperdrive, when set in `.env.{env}`       |
| `R2_BUCKET_NAME`               | R2 provisioned                             |
| `CLOUDFLARE_KV_NAME`           | KV provisioned                             |
| `CLOUDFLARE_KV_ID`             | KV provisioned                             |
| `CLOUDFLARE_QUEUE_NAME`        | Queue provisioned                          |
| `CLOUDFLARE_ANALYTICS_DATASET` | `$analytics` detected (derived, see below) |
| `CLOUDFLARE_DOMAIN`            | Domain configured                          |

You do not set these manually. `CLOUDFLARE_ANALYTICS_DATASET` is the one the
adapter derives rather than provisions: whenever a `$analytics` primitive is
declared it emits an `analytics_engine_datasets` binding (bound as
`ANALYTICS`) named `<project>-<env>`, because Cloudflare creates the dataset
on the first data point and there is no id to pair with the name the way KV and
D1 need one. An explicit value in `.env.{env}` overrides the name, and is the
only way to get the binding for an app that writes to Workers Analytics Engine
without declaring `$analytics`.

That binding is **write-only** - `env.ANALYTICS.writeDataPoint({...})`, which
returns nothing and is not awaited. Reading the data back is a different
mechanism entirely: `POST /accounts/{account_id}/analytics_engine/sql` over
plain HTTP with a bearer token scoped _Account · Account Analytics · Read_. Note
that permission is **account-wide** - Cloudflare offers no per-dataset analytics
read scope - so think about where that token lives before putting it in a Worker
that also serves unauthenticated routes.

### Deploy

Deploys via `wrangler deploy` using the generated `dist/wrangler.jsonc`. Returns the live Worker URL.

### Teardown

`alepha infra down` deletes resources in dependency order:

1. Queue consumers (unbind from worker)
2. Workers
3. Queues
4. KV namespaces
5. R2 buckets (non-empty buckets are wiped via S3 credentials first when available)
6. D1 databases / Hyperdrive configs

### Full Example

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { cloudflare, infra } from "alepha/cli/infra";

export default defineConfig({
  plugins: [
    infra({
      environments: {
        production: cloudflare({
          domain: "myapp.com",
        }),
      },
    }),
  ],
});
```

```bash filename=.env.production
STRIPE_SECRET_KEY=sk_live_...
```

```bash
alepha deploy
```

This authenticates with Cloudflare, provisions D1 + R2 + KV + Queue (based on your code), builds for Cloudflare Workers, runs D1 migrations, deploys the worker, and pushes `STRIPE_SECRET_KEY` as a secret.

### Temporary Environments

Prefix an environment name with `tmp` to create a throwaway deployment. Teardown skips the confirmation prompt.

```typescript
environments: {
  production: cloudflare({ domain: "myapp.com" }),
  staging: cloudflare({ domain: "staging.myapp.com" }),
  "tmp-pr-42": cloudflare(),
}
```

```bash
alepha deploy --env tmp-pr-42
# ... test ...
alepha infra down --env tmp-pr-42   # no confirmation
```

## Writing an adapter

An adapter is a class extending `InfraAdapter<TOptions>`, with two statics: `id`, its display name in `plan` and `status`, and `options`, the schema its environment's options are validated against. It reads them from `ctx.options`.

```typescript check filename=src/ExampleAdapter.ts
import { $module, z } from "alepha";
import {
  type EnvironmentDescriptor,
  InfraAdapter,
  type InfraContext,
  type InfraState,
} from "alepha/cli/infra-lib";

export interface ExampleOptions {
  region: string;
}

export class ExampleAdapter extends InfraAdapter<ExampleOptions> {
  static readonly id = "example";
  static readonly options = z.object({ region: z.text() });

  async authenticate(ctx: InfraContext<ExampleOptions>): Promise<void> {
    // Implement this adapter's local and CI authentication policy.
  }

  async build(ctx: InfraContext<ExampleOptions>): Promise<void> {}

  async deploy(ctx: InfraContext<ExampleOptions>): Promise<string | undefined> {
    return `https://${ctx.project}.${ctx.options.region}.example.com`;
  }

  async inspect(): Promise<InfraState> {
    return {
      workers: [],
      databases: [],
      buckets: [],
      kvNamespaces: [],
      queues: [],
      secrets: [],
    };
  }

  async teardown(): Promise<void> {}
}

export const AlephaExampleAdapter = $module({
  name: "example.infra",
  services: [ExampleAdapter],
});

export const example = (
  options: ExampleOptions,
): EnvironmentDescriptor<ExampleOptions> => ({
  adapter: ExampleAdapter,
  options,
});
```

Three rules keep it a good citizen:

- **Its own `$module`, with no `$command`.** `infra()` registers each environment's adapter class when the config loads, which registers the module that declares it. A command declared in that module would appear in `alepha --help`.
- **The factory's declared return type is the generic `EnvironmentDescriptor`**, so a published `.d.ts` names neither the adapter class nor anything it injects.
- **Secrets ride the deploy.** The pipeline runs `deploy` then `secrets`, so an adapter pushes them inside `deploy()` and leaves `secrets()` empty, or the new build boots once without them. `resolveSecretKeySet` and `selectSecrets` from `alepha/cli/infra-lib` resolve the same key set every adapter uses.

Override `provision`, `migrate`, `login`, `logout` or `exportDb` when the target has one, and set `controlsDomain = false` when the adapter does not put the environment's domain into effect itself.

## Tips

**Start with `plan`.** Run `alepha infra plan` before your first deploy. It shows what will be created without touching anything.

**Use temporary environments for PRs.** Name them `tmp-pr-<number>` and they tear down without confirmation. Great for preview deployments.

**Keep secrets in `.env.production`.** The infra plugin reads them automatically. Don't commit this file.

**Check status after deploy.** Run `alepha infra status` to verify everything is live and secrets are pushed.

## Breaking migration from the platform API

This is a source-breaking rename with no legacy command aliases or import barrels. Update consumers before installing the new framework. The left column below intentionally documents the removed API.

<!-- docs-check-migration -->

| Before                                                                    | After                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `alepha/cli/platform`                                                     | `alepha/cli/infra`                                           |
| `alepha/cli/platform-lib`                                                 | `alepha/cli/infra-lib`                                       |
| `platform(options)`                                                       | `infra(options)`                                             |
| `AlephaCliPlatformPlugin`                                                 | `AlephaCliInfraPlugin`                                       |
| `AlephaPlatformLibPlugin`                                                 | `AlephaInfraLibPlugin`                                       |
| `platformOptions`                                                         | `infraOptions`                                               |
| `PlatformOptions`                                                         | `InfraOptions`                                               |
| `PlatformAdapter`                                                         | `InfraAdapter`                                               |
| `PlatformAdapterClass`                                                    | `InfraAdapterClass`                                          |
| `PlatformContext`                                                         | `InfraContext`                                               |
| `PlatformState`                                                           | `InfraState`                                                 |
| `PlatformInspector`                                                       | `InfraInspector`                                             |
| `PlatformOrchestrator`                                                    | `InfraOrchestrator`                                          |
| `PlatformCacheProvider`                                                   | `InfraCacheProvider`                                         |
| `PlatformCommand`                                                         | `InfraCommand`                                               |
| `platformStatusWorkerSchema`                                              | `infraStatusWorkerSchema`                                    |
| `platformStatusResourceSchema`                                            | `infraStatusResourceSchema`                                  |
| `platformStatusSecretSchema`                                              | `infraStatusSecretSchema`                                    |
| `platformStatusSchema`                                                    | `infraStatusSchema`                                          |
| `PlatformStatusOutput`                                                    | `InfraStatusOutput`                                          |
| `platformPlanAppResourcesSchema`                                          | `infraPlanAppResourcesSchema`                                |
| `platformPlanAppSchema`                                                   | `infraPlanAppSchema`                                         |
| `platformPlanEnvironmentSchema`                                           | `infraPlanEnvironmentSchema`                                 |
| `platformPlanResourceSchema`                                              | `infraPlanResourceSchema`                                    |
| `platformPlanSchema`                                                      | `infraPlanSchema`                                            |
| `PlatformPlanOutput`                                                      | `InfraPlanOutput`                                            |
| `alepha.cli.platform`, `alepha.cli.platform-lib`                          | `alepha.cli.infra`, `alepha.cli.infra-lib`                   |
| `alepha platform up`, `alepha p up`                                       | `alepha deploy`                                              |
| `alepha platform`, `alepha p`                                             | `alepha infra` (help)                                        |
| `alepha platform plan`, `alepha p plan`                                   | `alepha infra plan`                                          |
| `alepha platform status`, `alepha p status`, `alepha p s`                 | `alepha infra status`, `alepha infra s`                      |
| `alepha platform auth login`, `alepha p auth login`                       | `alepha infra login --env <name>`                            |
| `alepha platform auth logout`, `alepha p auth logout`                     | `alepha infra logout --env <name>`                           |
| `alepha platform build`, `alepha p build`                                 | `alepha infra build`                                         |
| `alepha platform deploy`, `alepha p deploy`                               | `alepha infra deploy` (granular)                             |
| `alepha platform down`, `alepha p down`                                   | `alepha infra down --env <name>`                             |
| `alepha platform db ...`, `alepha p db ...`                               | `alepha infra db ...` (`migrate`, `export`, `baseline mark`) |
| `alepha platform secrets ...`, `alepha p secrets ...`, `alepha p sec ...` | `alepha infra secrets ...`, `alepha infra sec ...`           |

The old `auth` and `up` groups do not exist under `infra`. Standalone `provision` and root `migrate` commands do not exist: provisioning belongs to full deployment, and deployed migrations use `infra db migrate`.

<!-- /docs-check-migration -->

Adapter factories (`cloudflare`, `bay` and external factories such as `lore`), `EnvironmentDescriptor`, `DetectedResources`, `ResourceState`, `WorkerState`, `SecretState`, `ExportDbOptions`, provider-specific types/classes and the remaining service names keep their names. Only their import path changes where relevant. The library stays command-free; its workerd export remains the same subset, without Node adapters, disk stores or the built-in factories. Node consumers use the Node entry; Worker deploy services use `WorkerCloudflareAdapter` and explicit descriptors.

Programmatic `InfraOrchestrator.up()`, `auth()` and `printUpSummary()` retain their method names and behavior. Adapter methods, JSON field names and adapter ids also stay unchanged. `name`, `project`, `default`, `secrets`, the explicit environment map and `.env.*` files preserve their meanings. Keep configured names to retain existing resources: the examples in this repository remain `alepha-docs-production`, `alepha-ui-production` and `alepha-shop-production`. The internal cache still uses `node_modules/.alepha/platform.json`; the rename does not invalidate its format or identity.

### External consumers, not shipped by this repository

Lore has runtime imports to migrate, not just prose: its app config and deployment workflow; `@alepha/lore`'s CLI adapter, adapter tests and descriptor types; `@lore/deploy`'s runner, teardown, naming, rollback, asset-cache and secret services; its estate pull controller and rehearsal script. Replace the library imports and the renamed module/atom/classes/types using the table. Its external factory remains `lore()`; its remote build, secret and provisioning policies do not change because of this rename.

The framework's release and nightly workflows also run the installed `@alepha/lore` CLI. A release of that CLI still importing the removed library path will fail to start. The owner has reserved [Q2607](https://lore.alepha.dev/alepha/quests/2607) for this compatibility work after E73; it is not a dependency gate for this epic, and the migration is not claimed as shipped here.

Bay's repository has guide references in its README, installation instructions and introduction. Its Go host has no framework TypeScript imports to rename. Update that prose separately; Bay's host protocol and behavior remain unchanged. Other downstream apps, including Capacity and Mikanda, need their config helper/imports migrated before upgrading.
