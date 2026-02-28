# Cloudflare Workers Deployment

The `cloudflare` build target generates a Cloudflare Workers bundle with a `wrangler.jsonc` configuration.

## Build

```bash
alepha build --target=cloudflare
```

This forces the `workerd` runtime. You cannot combine `--target=cloudflare` with `--runtime=node` or `--runtime=bun`.

## Environment Variables

Required for deployment:

| Variable | Description |
|----------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | API token with Workers permissions |

## Deploy

`alepha deploy` detects the `wrangler.jsonc` in `dist/` and runs Wrangler:

```bash
alepha build --target=cloudflare
alepha deploy
```

If Wrangler is not installed, the deploy command installs it automatically as a dev dependency.

## Local Testing

Test the Worker locally before deploying:

```bash
wrangler dev --config=dist/wrangler.jsonc
```

## Generated Configuration

The build produces:

- `dist/wrangler.jsonc` -- Wrangler configuration with worker name, compatibility flags, and bindings
- `dist/main.cloudflare.js` -- Worker entry point that bootstraps Alepha and handles `fetch`, `scheduled`, and `queue` events

The `wrangler.jsonc` includes `nodejs_compat` compatibility flag and `no_bundle: true` (Alepha bundles the code itself).

## SQLite D1

Use Cloudflare D1 for the database. Set the `DATABASE_URL` in `.env.production`:

```bash
DATABASE_URL=d1://my-database:00000000-0000-0000-0000-000000000000
```

Format: `d1://<database-name>:<database-id>`

The build automatically adds the D1 binding to `wrangler.jsonc`:

```json
{
  "d1_databases": [{
    "binding": "my-database",
    "database_name": "my-database",
    "database_id": "00000000-0000-0000-0000-000000000000"
  }]
}
```

## R2 Buckets

If your application uses `$bucket` with `CloudflareR2Provider`, the R2 binding is added to `wrangler.jsonc` automatically.

## Cron Triggers

`$scheduler` cron expressions are detected at build time and mapped to Cloudflare Cron Triggers in `wrangler.jsonc`:

```json
{
  "triggers": {
    "crons": ["0 * * * *", "0 0 * * *"]
  }
}
```

The Worker's `scheduled` handler dispatches the `cloudflare:scheduled` event, which Alepha routes to the matching `$scheduler` handler.

## Build with Mode

Use `--mode` to control which `.env` file is loaded:

```bash
alepha build --target=cloudflare --mode production
```

This loads `.env` and `.env.production` before building.

## Static Assets

If your project has a React frontend, the built client assets are placed in `dist/public/` and served via Cloudflare's asset binding.

## Queue

`$queue` and `$job` are supported via [Cloudflare Queues](https://developers.cloudflare.com/queues/). The build automatically adds the `JOBS_QUEUE` binding and `queue` consumer to `wrangler.jsonc` when queue primitives are detected.

At runtime, `CloudflareQueueProvider` replaces the default queue provider and `WorkerdWorkerProvider` handles message consumption via push-based `queue` events (no polling).

## Limitations

- **Redis-based features** (`$lock` with Redis, `$cache` with Redis, `$topic` with Redis) are not available

## Configuration

```typescript
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    target: "cloudflare",
    cloudflare: {
      config: {
        // Additional wrangler.jsonc fields merged into the generated config
      },
    },
  },
});
```

## Full Example

```bash
# .env.production
DATABASE_URL=d1://alepha-app:00000000-0000-0000-0000-000000000000

# Build and deploy
alepha build --target=cloudflare --mode production
alepha deploy
```
