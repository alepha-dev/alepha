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

The recommended path is the [platform plugin](/docs/cli-plugins-platform), which provisions resources, builds, migrates, deploys, and pushes secrets in one command (installing Wrangler automatically if missing):

```bash
alepha p up
```

To deploy a build manually instead:

```bash
alepha build --target=cloudflare
cd dist && wrangler deploy
```

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

The build automatically adds the D1 binding to `wrangler.jsonc` (the binding is always named `DB`), and rewrites the deployed `DATABASE_URL` to reference it:

```json
{
  "d1_databases": [{
    "binding": "DB",
    "database_name": "my-database",
    "database_id": "00000000-0000-0000-0000-000000000000"
  }],
  "vars": { "DATABASE_URL": "d1://DB" }
}
```

## R2 Buckets

The R2 binding is added to `wrangler.jsonc` when `R2_BUCKET_NAME` is set at build time — the platform plugin sets it automatically when your app declares any `$storage`; for a manual build, set it yourself in the environment. R2 keys every object as `{APP_NAME}/{tenantId}/{storage}/{fileId}` inside that one bucket — a storage is a prefix, not a bucket of its own.

## Cron Triggers

`$job({ cron })` expressions are detected at build time and mapped to Cloudflare Cron Triggers in `wrangler.jsonc`:

```json
{
  "triggers": {
    "crons": ["0 * * * *", "0 0 * * *"]
  }
}
```

The Worker's `scheduled` handler dispatches the `cloudflare:scheduled` event, which Alepha routes to the matching `$job` handler.

## Build with Mode

Use `--mode` to control which `.env` file is loaded:

```bash
alepha build --target=cloudflare --mode production
```

This loads `.env` and `.env.production` before building.

## WebSockets and Rooms

Apps registering `$websocket` or `$room` primitives get their realtime wiring automatically — the two are treated identically, so a rooms-only app needs no extra configuration:

- the worker entry gets a WebSocket upgrade branch routing each registered channel path to a Durable Object
- `wrangler.jsonc` gets the `ALEPHA_WEBSOCKET` Durable Object binding and its SQLite migration (skipped if your own `cloudflare.config.migrations` already declares `AlephaWebSocketDurableObject`; otherwise the first free `v<n>` tag is used)
- the server bundle re-exports the `AlephaWebSocketDurableObject` class so wrangler can resolve it
- `secure: true` on either primitive rejects unauthenticated upgrades with a 401

## Static Assets

If your project has a React frontend, the built client assets are placed in `dist/public/` and served via Cloudflare's asset binding.

## Queue

`$job` dispatch can travel through [Cloudflare Queues](https://developers.cloudflare.com/queues/). The build automatically adds the `JOBS_QUEUE` binding, the `queue` consumer and a dead-letter queue to `wrangler.jsonc` when `AlephaApiJobsQueue` is registered.

At runtime, `CloudflareQueueProvider` replaces the default queue provider and `WorkerdWorkerProvider` handles message consumption via push-based `queue` events (no polling). Messages are sent in batches of up to 100 per `sendBatch` call, so a `pushMany()` of 500 jobs costs 5 subrequests rather than 500.

A `$job` handler that throws is caught and recorded by `JobProvider`, so it acks and retries through the outbox sweep. Only infrastructure failures — an undecodable message, an unreachable backend — propagate to `msg.retry()` and eventually land in the dead-letter queue.

## Jobs without a queue (direct mode)

Cloudflare Queues are powerful but overkill for low-volume apps. By default, `$job` falls back to **direct mode** when `AlephaApiJobsQueue` is not loaded:

- `push()` writes a row to the outbox table, then schedules the handler in-process so the HTTP response returns immediately.
- If the worker invocation ends before the handler finishes, the next reconciliation sweep re-dispatches the row.

This is the recommended default on Cloudflare Workers when you don't want a Queues binding. Add `.with(AlephaApiJobsQueue)` only when you need a real queue.

## Retry granularity

`$job` retries are **sweep-driven** on every platform — there's no exponential backoff. When a handler fails, the row is marked `scheduled` with `scheduledAt = now`, and the next sweep tick (configured by `jobConfig.sweepCron`, default `*/15 * * * *`) picks it up.

Practically this means:

- A job retried 3 times can take up to ~45 minutes total to fail terminally.
- The first retry can happen anywhere between a few seconds and ~15 minutes after the failure, depending on when the next sweep tick fires.
- If you need tighter retry latency, lower `sweepCron` in your `jobConfig` atom.

This is identical on Node, Docker, and Cloudflare — no platform-specific timing surprises.

## Limitations

- **Redis-based features** (`$lock` with Redis, `$cache` with Redis, `$topic` with Redis) are not available

## Configuration

```typescript check
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
cd dist && wrangler deploy
```
