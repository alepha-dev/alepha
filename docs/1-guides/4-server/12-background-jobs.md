# Background Jobs

`$job` is the primitive for work that happens outside a request. It is backed by
a database table (the *outbox*), which is what makes it durable: a push writes a
row before anything runs, so a handler that throws — or a process that dies
mid-flight — leaves a record that a reconciliation sweep picks back up.

```typescript check
import { $job } from "alepha/api/jobs";
```

`$job` lives under `alepha/api/` because it needs an ORM connection and ships an
admin controller. Register the module alongside your other API modules:

```typescript
import { AlephaApiJobs } from "alepha/api/jobs";

alepha.with(AlephaApiJobs);
```

## Two modes, never both

A job declares **either** `schema` (queue-mode, push-driven) **or** `cron`
(cron-mode, schedule-driven). Declaring both is a configuration error.

```typescript check
import { z } from "alepha";
import { $job } from "alepha/api/jobs";

class Emails {
  // queue-mode — call push() to enqueue work
  welcome = $job({
    schema: z.object({ userId: z.text() }),
    retry: { retries: 3 },
    handler: async ({ payload, attempt }) => {
      // send the welcome email for payload.userId
    },
  });

  // cron-mode — fires on a schedule, no payload
  digest = $job({
    cron: "0 8 * * *",
    handler: async () => {
      // build and send the daily digest
    },
  });
}
```

To run scheduled work *over a set of payloads*, compose the two: a cron job that
pushes, and a queue job that handles.

```typescript
class Reminders {
  sweep = $job({
    cron: "0 * * * *",
    handler: async () => {
      const due = await this.repository.findMany({ where: { due: true } });
      await this.remind.pushMany(due.map((row) => ({ payload: { id: row.id } })));
    },
  });

  remind = $job({
    schema: z.object({ id: z.text() }),
    handler: async ({ payload }) => { /* ... */ },
  });
}
```

## Pushing work

```typescript
const executionId = await this.welcome.push({ userId: "u1" });
```

`push()` accepts a second options argument:

| Option | Type | Description |
|--------|------|-------------|
| `delay` | `DurationLike` | Run no earlier than now + delay |
| `scheduledAt` | `Date` | Run no earlier than this instant |
| `key` | `string` | Deduplication key — see the caveat below |
| `priority` | `"critical" \| "high" \| "normal" \| "low"` | Sweep dispatch order when there is a backlog |
| `organizationId` | `string` | Owning tenant, persisted on the row for tenant-scoped admin views |

`pushMany()` takes an array of `{ payload, key?, delay?, priority?, scheduledAt? }`
and writes them in a batched INSERT.

### `key` dedups in-flight work, not completed work

A push with a `key` returns the existing execution id instead of enqueueing a
second row — but only while a row with that key still exists. On success the row
is either deleted (`record: "error"`, the queue-mode default) or updated with
`key` set to `null`. Either way **the key is released once the job succeeds**.

So `key` means *"don't enqueue this twice while it's still pending, running, or
failing"* — it is not *"run this at most once ever"*. If you need the stronger
guarantee, enforce it in the handler against your own data.

## Retries

Set `retry: { retries: n }`, optionally with `when: (error) => boolean` to retry
only certain failures. Retries are **sweep-driven and have no exponential
backoff**: a failed attempt is rescheduled with `scheduledAt = now`, and the
next sweep tick picks it up.

That means retry latency is bounded by `sweepCron` (default `*/15 * * * *`). The
first retry lands anywhere from a few seconds to ~15 minutes later, depending on
where the tick falls. Lower `sweepCron` if you need tighter latency.

Cron-mode jobs without `retry` do not retry — the next tick is the retry. Cron
jobs that *declare* `retry` go through the same sweep path, which is useful for
once-daily jobs where waiting a full day is not acceptable.

## Timeouts and cancellation

`timeout` caps a single attempt. The handler receives an `AbortSignal` — pass it
to anything that supports one, since Alepha cannot interrupt synchronous work:

```typescript
report = $job({
  schema: z.object({ id: z.text() }),
  timeout: "30 seconds",
  handler: async ({ payload, signal }) => {
    await fetch(`https://example.com/${payload.id}`, { signal });
  },
});
```

`await job.cancel(executionId)` cancels a pending or running execution.

## Dispatch modes

How a pushed execution reaches its handler depends on which modules are loaded:

- **direct** (default) — the handler runs in-process right after `push()`
  returns. The outbox row is the durability guarantee: if the process dies, the
  sweep re-dispatches. Best for single-instance Node and Cloudflare Workers,
  where standing up a broker is overkill.
- **queue** — add `AlephaApiJobsQueue` and dispatch goes through a real broker
  (Cloudflare Queues, Redis) so a worker pool consumes the work.

```typescript
import { AlephaApiJobs, AlephaApiJobsQueue } from "alepha/api/jobs";

alepha.with(AlephaApiJobs).with(AlephaApiJobsQueue);
```

Both modes are at-least-once. Write handlers to be idempotent.

## Retention

Queue-mode jobs default to `record: "error"` — the pending row is written at
push time and removed on success, so a healthy queue leaves no rows behind.
Cron jobs default to `record: "all"` with one retained success so the admin
"Last run" column is accurate.

| Setting | Effect |
|---------|--------|
| `record: "error"` | Keep error and cancelled rows only (queue default) |
| `record: "all"` | Keep successes too, trimmed to `keepLastSuccess` |
| `record: "none"` | Fire-and-forget, no row even on error |
| `keep: { ok, error }` | Per-job override. `0` here means **keep forever** |

Note the deliberate asymmetry: per-job `keep.ok: 0` means *never trim*, while
the global `keepLastSuccess: 0` means *delete on success*.

## Configuration

Tune the `jobConfig` atom:

```typescript
import { jobConfig } from "alepha/api/jobs";

alepha.set(jobConfig, { sweepCron: "*/5 * * * *" });
```

| Key | Default | Description |
|-----|---------|-------------|
| `sweepCron` | `*/15 * * * *` | Reconciliation sweep — bounds retry latency |
| `trimCron` | `0 * * * *` | Ring-buffer trim tick |
| `staleThreshold` | `300000` | Pending age (ms) before the sweep re-dispatches |
| `runTimeout` | `1800000` | Running age (ms) before a crash is assumed |
| `keepLastSuccess` | `10` | Successful rows kept per job |
| `keepLastError` | `10` | Error rows kept per job |
| `drainTimeout` | `30000` | Time (ms) to wait for in-flight jobs on shutdown |

## Multi-replica deployments

Cron-mode jobs take a distributed lock per tick (`lock: true` by default), so a
fleet of replicas fires the handler once, not once per replica. This needs a
real `LockProvider` — the default `MemoryLockProvider` is per-process. See
[Bare metal deployment](/docs/guides-deployment-bare) for the setup.

`lock` has no effect on queue-mode and direct-mode jobs. Those serialize through
the outbox `claim()` UPDATE-guard instead, which is always on.

## Events

`$job` emits lifecycle events you can hook:

| Event | Payload |
|-------|---------|
| `job:begin` | `{ name, now, executionId }` |
| `job:success` | `{ name, executionId }` |
| `job:error` | `{ name, error, executionId }` |
| `job:cancel` | `{ name, executionId }` |
| `job:end` | `{ name, executionId }` |

## When not to use `$job`

- **A bare periodic tick with no database.** `$job` needs an ORM connection.
  For a tick without one, register directly against the cron engine:

  ```typescript
  import { CronProvider } from "alepha/scheduler";

  class Ticker {
    protected readonly cron = $inject(CronProvider);

    protected readonly setup = $hook({
      on: "start",
      handler: () => {
        this.cron.createCronJob("revalidate", "0 * * * *", async () => {
          // ...
        });
      },
    });
  }
  ```

  You get the tick and the distributed lock, but no run history, no retry and
  nothing in the admin UI. Reach for it only when a database is genuinely
  unavailable.
- **Fan-out to many subscribers.** Use `$topic` / `$subscriber`, which is
  publish/subscribe rather than work distribution.
