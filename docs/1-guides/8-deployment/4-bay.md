# Bay Deployment

Bay is a self-hosted application server for Alepha apps. Where Cloudflare gives you someone else's
serverless platform, Bay runs your apps as ordinary long-lived processes on a machine you own — with
TLS, rollback and process isolation handled for you.

Use it when you want a long-lived runtime (background work between requests, in-process caches, a
local SQLite file), when you would rather pay for one VPS than per-request, or when the data has to
stay on hardware you control.

## Build

```bash
alepha build --target=bare
```

That is the whole target-specific story: Bay has no `wrangler.jsonc` equivalent, because everything
it needs is already in the build manifest. `alepha platform up` runs this for you.

## Configuration

```typescript
platform({
  environments: {
    production: {
      adapter: "bay",
      endpoint: "https://admin.example.com",
      domain: "myapp.com",
    },
  },
});
```

`endpoint` is the Bay admin panel that owns the machine, and it is **required** — unlike Cloudflare
there is no global endpoint to fall back on, because a Bay is a machine someone owns. Set it in the
config or export `BAY_ENDPOINT`.

## Log in

```bash
alepha platform auth login --env production
```

This runs an OAuth device flow (RFC 8628) against the endpoint: the CLI prints a code, you approve it
in the browser, and the credential is stored with its refresh token so long deploys do not expire
mid-flight. The endpoint must be a Bay admin panel with its OAuth server enabled, and the approving
user needs the admin role.

For CI, skip the flow and export a key instead:

```bash
BAY_API_KEY=... alepha platform up --env production
```

```bash
alepha platform auth logout --env production
```

## Deploy

```bash
alepha platform up --env production
```

Under the hood: `alepha build --target=bare`, then `alepha pack` — which produces
`<project>-latest.tar.gz` containing the bundle and its `migrations/` directory — then an upload of
that artifact to the endpoint.

Bay takes it from there: it reads the manifest, creates the database, the storage directory and the
cron entries the app declares, starts the new release, waits for `/health` to answer, swaps traffic
over, and keeps the previous release around to roll back to if readiness never arrives.

## Resources

You do not provision anything from the CLI. Cloudflare needs `provision` because D1, R2 and KV are
account-level resources created through an API; Bay creates what the manifest asks for on the machine
itself, at deploy time.

The practical consequence: `alepha platform status` reports the running app and its release, and
reports **empty** database and storage lists. That is deliberate honesty rather than a gap — Bay
exposes no inventory of what it created, and listing what the manifest *asked for* would report
intent as fact.

## Migrations

There is no migrate step, and `alepha platform migrate` is a no-op on Bay.

Migrations are the app's own business here: Alepha runs them during its own boot as soon as a
`migrations/` directory sits next to the bundle, and `alepha pack` always includes one. Redeploying
the app *is* migrating it.

## Status and teardown

```bash
alepha platform status --env production
alepha platform down --env production
```

`down` removes the app from the Bay. Note that on Bay the database and the uploads live inside the
app's own directory, so tearing an environment down takes its data with it — there is no separate
managed database that outlives the app.

## Bay versus Cloudflare

| | Bay | Cloudflare |
|---|---|---|
| Runtime | long-lived Node/Bun process | `workerd` isolate, per request |
| Build target | `bare` | `cloudflare` (forces `workerd`) |
| Provisioning | by Bay, from the manifest, at deploy | by the CLI, via the Cloudflare API |
| Database | SQLite file (or your own Postgres) in the app directory | D1, or Postgres via Hyperdrive |
| Migrations | at app boot | `alepha platform migrate` |
| Login | device flow against your endpoint | `wrangler login` |
| Rollback | automatic on failed readiness | redeploy the previous version |
| Scaling | one machine | Cloudflare's edge |

Both provision from your `$repository` / `$storage` / `$cache` / `$job` declarations — you do not
maintain infrastructure config by hand on either.

## Full example

```typescript
// alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  plugins: [
    platform({
      environments: {
        production: {
          adapter: "bay",
          endpoint: "https://admin.example.com",
          domain: "myapp.com",
        },
        staging: {
          adapter: "bay",
          endpoint: "https://admin.example.com",
        },
      },
    }),
  ],
});
```

```bash
alepha platform auth login --env production
alepha platform plan --env production   # shows what will happen, touches nothing
alepha platform up --env production
```
