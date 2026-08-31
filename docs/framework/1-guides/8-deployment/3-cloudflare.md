# Cloudflare Workers Deployment

The `cloudflare` build target generates a Cloudflare Workers bundle with a `wrangler.jsonc` configuration.

## Build

```bash
alepha build --target=cloudflare
```

This forces the `workerd` runtime. You cannot combine `--target=cloudflare` with `--runtime=node` or `--runtime=bun`.

## Environment Variables

Required for deployment:

| Variable                | Description                                                                |
| ----------------------- | -------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID                                                 |
| `CLOUDFLARE_API_TOKEN`  | API token with Workers permissions (or run `wrangler login` interactively) |

`CLOUDFLARE_ANALYTICS_TOKEN` is **not** a deploy credential - it is the optional, app-runtime Analytics Engine read token (scope: Account Analytics · Read). It is deliberately named differently from `CLOUDFLARE_API_TOKEN`: wrangler treats that name as its own credential, so putting a read-only token there makes every provisioning call fail with an authentication error.

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

- `dist/wrangler.jsonc`: Wrangler configuration with worker name, compatibility flags, and bindings
- `dist/main.cloudflare.js`: Worker entry point that bootstraps Alepha and handles `fetch`, `scheduled`, and `queue` events

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
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-database",
      "database_id": "00000000-0000-0000-0000-000000000000"
    }
  ],
  "vars": { "DATABASE_URL": "d1://DB" }
}
```

### Query timeouts

A D1 query has no client-side deadline of its own, so a slow one occupies the
Worker until the platform kills the whole invocation. Two variables bound it:

| Variable                 | Values                     | Default                             |
| ------------------------ | -------------------------- | ----------------------------------- |
| `DATABASE_TIMEOUT`       | milliseconds, `0` disables | `5000` on serverless, off elsewhere |
| `DATABASE_TIMEOUT_SCOPE` | `all`, `reads`             | `all`                               |

The budget is on by default on serverless because that is where an unbounded
query costs an invocation rather than a connection. `reads` narrows it to
statements that only read, for an app that would rather a long write finish
than be abandoned halfway.

### Read replication

D1 can serve reads from regional replicas, which lowers read latency for users
far from the primary. It does nothing unless the code opens a **session**:
without `withSession`, every query goes to the primary whatever the dashboard
says.

```bash
DATABASE_D1_MODE=sessions   # 'primary' is the default
```

**⚠️ This is a latency and throughput feature, not an availability one.** A
replica may happen to answer while the primary is busy, but Cloudflare
documents no such guarantee, and it must not be relied on as one. If the
primary is down, treat the database as down.

**The consistency model, and the one thing to understand.** A session is
anchored to a _bookmark_: a position in the database's history. Reads inside
a session see everything up to that bookmark, so within one session you always
read your own writes. Across requests the bookmark has to travel, or a user
who just created something can be served by a replica that has not caught up
and the write appears to have vanished.

Alepha carries it for you, in a cookie:

```
set-cookie: alepha_d1_bookmark=<bookmark>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600
```

A cookie rather than a header because the browser returns it with no
client-side code. An API client that does not keep cookies gets a fresh
session per request, which is correct but forfeits read-your-writes across
calls - send the cookie back yourself if that matters.

Two consequences worth knowing before switching it on:

- **A response that sets the bookmark cookie is not edge-cacheable.** Alepha
  decides cacheability before attaching the cookie, and the two are mutually
  exclusive: a shared public response cannot depend on one caller's read
  position.
- **The default is `primary`, deliberately.** It changes consistency
  semantics, and a bookmark-propagation bug surfaces as stale reads, which is
  an unpleasant class of bug to chase. Turn it on for an app whose users are
  spread across regions, and leave it off for one whose primary already sits
  next to its traffic.

Enabling replication on the database itself is a separate, one-time action in
the Cloudflare dashboard. Setting `DATABASE_D1_MODE=sessions` without it, or
enabling it without the flag, changes nothing on its own.

## R2 Buckets

The R2 binding is added to `wrangler.jsonc` when `R2_BUCKET_NAME` is set at build time - the platform plugin sets it automatically when your app declares any `$storage`; for a manual build, set it yourself in the environment. R2 keys every object as `{prefix}/{tenantId}/{storage}/{fileId}` inside that one bucket - a storage is a prefix, not a bucket of its own. The leading prefix comes from `S3_KEY_PREFIX`, falling back to `APP_NAME`.

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

Expressions are **deduplicated**, so what costs you a Cron Trigger is the number
of _distinct_ expressions, not the number of jobs. Jobs sharing an expression
all run in the same invocation. The framework's own sweeps default to
`*/15 * * * *` for this reason - see
[Sweeps owned by other modules](/docs/guides-server-background-jobs) for the atoms
that tune them, and prefer aligning a new `$job` with an expression already in
use over introducing a sixth one.

⚠️ **Cron Triggers are capped per ACCOUNT, not per Worker**: 5 on the free plan,
250 on paid. Two Alepha apps on one free account can exceed it between them
before either declares a `$job` of its own. The build warns past five and names
the expressions it emitted.

A cron's CPU budget also depends on its interval: **30 seconds under an hourly
interval, 15 minutes at or above.** Wall clock is 15 minutes either way. The
default `*/15 * * * *` sweep sits on the 30-second side, which is deliberate -
measured p99 is 58 ms against it, and raising the interval to collect the
larger tier would make crash recovery four times slower for a budget that is
500x from binding.

## Build with Mode

Use `--mode` to control which `.env` file is loaded:

```bash
alepha build --target=cloudflare --mode production
```

This loads `.env` and `.env.production` before building.

## WebSockets and Rooms

Apps registering `$websocket` or `$room` primitives get their realtime wiring automatically - the two are treated identically, so a rooms-only app needs no extra configuration:

- the worker entry gets a WebSocket upgrade branch routing each registered channel path to a Durable Object
- `wrangler.jsonc` gets the `ALEPHA_WEBSOCKET` Durable Object binding and its SQLite migration (skipped if your own `cloudflare.config.migrations` already declares `AlephaWebSocketDurableObject`; otherwise the first free `v<n>` tag is used)
- the server bundle re-exports the `AlephaWebSocketDurableObject` class so wrangler can resolve it
- `secure: true` on either primitive rejects unauthenticated upgrades with a 401

## Static Assets

If your project has a React frontend, the built client assets are placed in `dist/public/` and served via Cloudflare's asset binding.

## Queue

`$job` dispatch can travel through [Cloudflare Queues](https://developers.cloudflare.com/queues/). The build automatically adds the `JOBS_QUEUE` binding, the `queue` consumer and a dead-letter queue to `wrangler.jsonc` when `AlephaApiJobsQueue` is registered.

At runtime, `CloudflareQueueProvider` replaces the default queue provider and `WorkerdWorkerProvider` handles message consumption via push-based `queue` events (no polling). Messages are sent in batches of up to 100 per `sendBatch` call, so a `pushMany()` of 500 jobs costs 5 subrequests rather than 500.

A `$job` handler that throws is caught and recorded by `JobProvider`, so it acks and retries through the outbox sweep. Only infrastructure failures - an undecodable message, an unreachable backend - propagate to `msg.retry()` and eventually land in the dead-letter queue.

⚠️ **The dead-letter queue catches less than its name suggests, and nothing
consumes it.** Because handler errors are absorbed by `JobProvider`, the DLQ
only ever collects undecodable envelopes and broker failures - never a failed
job. Failed jobs live on their outbox row and appear in the admin UI, which is
where to look. Nothing surfaces the DLQ's depth, so treat a message landing
there as an infrastructure problem you will have to go looking for.

**Queues are the recommended path for anything long-running or high-volume on
Cloudflare**, for the reason in the next section: a queue consumer gets 15
minutes of wall clock _and_ 15 minutes of CPU, the most generous surface the
platform offers, and the transport can hold a delayed message so retries land
on their backoff instead of on the sweep grid.

## Jobs without a queue (direct mode)

By default `$job` falls back to **direct mode** when `AlephaApiJobsQueue` is not
loaded:

- `push()` writes a row to the outbox table, then schedules the handler
  in-process so the HTTP response returns immediately.
- If the worker invocation ends before the handler finishes, the next
  reconciliation sweep re-dispatches the row.

That is a fine default for low-volume, short work. But on Workers it is **a
different reliability contract, not just the cheaper option**, and the API
gives you no hint of the cliff:

- **A job pushed from a request has about 30 seconds of wall clock.** The
  isolate is kept alive by `executionCtx.waitUntil`, which Cloudflare caps
  there. A declared `timeout` longer than that is simply unreachable, and the
  build now warns when it sees one.
- **Crash recovery is derived from the declared timeout**, at twice its value.
  So a job declaring `timeout: [10, "minute"]` and killed at 30 seconds sits
  `running` for **twenty minutes** before the sweep will even consider it
  crashed.
- **Timers do not survive.** A local timer armed after the response never
  fires, so delayed pushes and retry backoff both degrade to sweep
  granularity here (see below).
- **`pushMany` fan-out drips.** Concurrency is bounded, and each slice gets the
  same 30-second window.

None of this applies on long-running Node, and none of it applies behind a
queue.

## Retry granularity

`$job` retries use exponential backoff with full jitter. The outbox row's
`scheduledAt` is the truth and the sweep is the backstop, so nothing is ever
lost; what differs by runtime is only how soon anything looks at the row.

| Setup                          | Retry lands                       |
| ------------------------------ | --------------------------------- |
| Node, either dispatcher        | at the backoff, on a local timer  |
| Workers + `AlephaApiJobsQueue` | at the backoff, held by the queue |
| Workers, direct mode           | **at the next `sweepCron` tick**  |

The last row is the residual limit of direct mode on Workers, and it is
inherent rather than an oversight: there is no in-process way to schedule a
wake-up once the isolate has frozen. Practically, a retry there can land
anywhere between a few seconds and ~15 minutes after the failure.

Two ways out, depending on what you need:

- Register `AlephaApiJobsQueue` so the transport can hold the message.
- For a payload that expires before the next tick - a verification code lives
  300 seconds while the sweep runs every 900 - use `push(payload, { inline:
true })`, which runs the handler in front of the caller and fails terminally
  instead of retrying something that will arrive stale.

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
