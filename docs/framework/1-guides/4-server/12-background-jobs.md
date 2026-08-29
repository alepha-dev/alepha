# Background Jobs

`$job` is the primitive for work that happens outside a request. It is backed by
a database table (the _outbox_), which is what makes it durable: a push writes a
row before anything runs, so a handler that throws - or a process that dies
mid-flight - leaves a record that a reconciliation sweep picks back up.

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
  // queue-mode - call push() to enqueue work
  welcome = $job({
    schema: z.object({ userId: z.text() }),
    retry: { retries: 3 },
    handler: async ({ payload, attempt }) => {
      // send the welcome email for payload.userId
    },
  });

  // cron-mode - fires on a schedule, no payload
  digest = $job({
    cron: "0 8 * * *",
    handler: async () => {
      // build and send the daily digest
    },
  });
}
```

To run scheduled work _over a set of payloads_, compose the two: a cron job that
pushes, and a queue job that handles.

```typescript
class Reminders {
  sweep = $job({
    cron: "0 * * * *",
    handler: async () => {
      const due = await this.repository.findMany({ where: { due: true } });
      await this.remind.pushMany(
        due.map((row) => ({ payload: { id: row.id } })),
      );
    },
  });

  remind = $job({
    schema: z.object({ id: z.text() }),
    handler: async ({ payload }) => {
      /* ... */
    },
  });
}
```

## Pushing work

```typescript
const executionId = await this.welcome.push({ userId: "u1" });
```

`push()` accepts a second options argument:

| Option           | Type                                        | Description                                                       |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `delay`          | `DurationLike`                              | Run no earlier than now + delay                                   |
| `scheduledAt`    | `Date`                                      | Run no earlier than this instant                                  |
| `key`            | `string`                                    | Deduplication key - see the caveat below                          |
| `priority`       | `"critical" \| "high" \| "normal" \| "low"` | Sweep dispatch order when there is a backlog                      |
| `organizationId` | `string`                                    | Owning tenant, persisted on the row for tenant-scoped admin views |

`pushMany()` takes an array of `{ payload, key?, delay?, priority?, scheduledAt? }`
and writes them in a batched INSERT.

### `key` dedups in-flight work, not completed work

A push with a `key` returns the existing execution id instead of enqueueing a
second row - but only while a row with that key still exists. On success the row
is either deleted (`record: "error"`, the queue-mode default) or updated with
`key` set to `null`. Either way **the key is released once the job succeeds**.

So `key` means _"don't enqueue this twice while it's still pending, running, or
failing"_ - it is not _"run this at most once ever"_. If you need the stronger
guarantee, enforce it in the handler against your own data.

## Retries

Set `retry: { retries: n }`, optionally with `when: (error) => boolean` to retry
only certain failures.

A failed attempt is rescheduled with **exponential backoff and full jitter**:
attempt _n_ waits a uniformly random time in
`[0, min(retryBackoffMax, retryBackoffBase * 2^(n-1))]`, defaults 5 s and
30 min. The jitter matters at least as much as the curve - without it every
retrying row in the system shares one `scheduledAt` and they all hit a
struggling downstream together.

The row's `scheduledAt` is the truth and the sweep is the backstop, so nothing
can lose a retry. What varies by runtime is only **how soon** something looks
at it:

| Runtime                                   | Dispatch        | Retry lands                       |
| ----------------------------------------- | --------------- | --------------------------------- |
| Node, any dispatcher                      | direct or queue | at the backoff, on a local timer  |
| Cloudflare Workers + `AlephaApiJobsQueue` | queue           | at the backoff, held by the queue |
| Cloudflare Workers, no queue              | direct          | **next sweep tick** (see below)   |

The last row is a real limit, not an oversight. A timer armed after the
response never fires on Workers - the isolate freezes once `waitUntil`
settles - so direct mode there cannot arrange a wake-up at all and retries
keep `sweepCron` granularity. Add `AlephaApiJobsQueue` if that matters, or use
[`inline`](#inline-when-a-retry-is-worse-than-a-failure) for a payload that
expires before the next tick.

Cron-mode jobs without `retry` do not retry - the next tick is the retry. Cron
jobs that _declare_ `retry` go through the outbox instead, which is useful for
once-daily jobs where waiting a full day is not acceptable.

### What a transport does with a delay

`$job` asks exactly one thing of a transport: **do not deliver before time T.**
Durability, retry policy, attempt counting, dead-lettering and crash recovery
are all already owned by the outbox, which is why the interface carries one
optional argument rather than a broker abstraction.

The rule every backend follows:

> `delaySeconds` is an optimisation. The outbox row's `scheduledAt` is the
> truth, and the sweep is the backstop. A backend that cannot honour a delay
> must **decline to enqueue** rather than enqueue immediately.

Declining is not the same as ignoring. For a push transport, ignoring a delay
means _delivering now_, and for a retry that is worse than doing nothing at
all: no backoff whatsoever against a downstream that has just failed.

| Backend           | Delay                                                          |
| ----------------- | -------------------------------------------------------------- |
| Cloudflare Queues | native, clamped at its 12-hour ceiling                         |
| in-memory         | a due timestamp, filtered on pop                               |
| Redis             | **declines**; the caller falls back to a local promoting timer |

The Redis decline costs nothing on Node, because the fallback timer _promotes_
the row rather than delivering it - a guarded `scheduled -> pending` update, so
exactly one replica wins, and a replica that dies leaves the row for the sweep.
Which is why there is no Redis delay tier: it would be a scale optimisation,
not a correctness fix.

## `inline`: when a retry is worse than a failure

Some payloads expire. A verification code lives 300 seconds by default while
the sweep runs every 900, so a retried code is **guaranteed** to arrive after
it expired: all three attempts produce garbage and the user meanwhile sees
nothing at all.

`inline` says: run the handler here, make me wait, and if it fails tell me.

```typescript
await myJob.push(payload, { inline: true });
// resolves -> the handler ran to completion, outbox row terminal
// rejects  -> the handler failed, row terminal `error`, nothing retries it
```

No dispatcher, no queue, no `waitUntil`. Behaviour is identical with and
without `AlephaApiJobsQueue`, because the flag bypasses `JobDispatcher`
entirely.

Two things it does, and it is worth separating them:

1. **The caller learns.** A password reset fails in front of the user, who can
   simply ask for another one, instead of quietly succeeding on attempt two
   with a code that no longer works.
2. **A failure is terminal, never `scheduled`.** This half holds even where the
   caller swallows the rejection, and it is the one that closes the expired-code
   problem: nothing will deliver that payload later.

**Per push, not per job.** Declare it on the job as a default if you like, but
the useful form is the call-site override, because one job usually sits behind
many callers - `sendNotification` is the single job behind every notification.
Whether you can afford to wait is a property of the call site.

```typescript
await myJob.push(payload); //                 async, retries per the policy
await myJob.push(payload, { inline: true }); // this one waits, and does not retry
```

On a job that declares `retry`, a per-push `inline` means _this execution does
not retry_: one attempt, terminal on failure, thrown to you. Declaring `inline`
and `retry` together **on the job** is rejected at registration, as is `inline`
with `cron` (a tick has no caller to block) and `inline` on `pushMany`.

Read the contract precisely:

- **"Ran to completion" means the handler resolved.** For an email that is the
  provider accepting the message, not delivery to an inbox.
- **Call it after the commit, not inside a transaction.** An email cannot be
  rolled back, so sending inside a transaction that later fails means mailing a
  code for a row that no longer exists. `inline` buys ordering, not
  transactionality.
- **Never on a message addressed to somebody other than the caller.** Blocking
  a login or registration response on a mail to the account _owner_ turns
  response time into an account-enumeration oracle: a slow answer means the
  account existed. Alepha's own `registrationAttempt` and `accountLockout`
  notifications are excluded for exactly this reason.

Not to be confused with `$notification`'s `critical`, which is a different
property one layer up: that one means the recipient cannot opt out.

## Timeouts and cancellation

`timeout` caps a single attempt. The handler receives an `AbortSignal` - pass it
to anything that supports one, since Alepha cannot interrupt synchronous work:

```typescript
report = $job({
  schema: z.object({ id: z.text() }),
  timeout: [30, "seconds"],
  handler: async ({ payload, signal }) => {
    await fetch(`https://example.com/${payload.id}`, { signal });
  },
});
```

`await job.cancel(executionId)` cancels a pending or running execution.

## Dispatch modes

How a pushed execution reaches its handler depends on which modules are loaded:

- **direct** (default): the handler runs in-process right after `push()`
  returns. The outbox row is the durability guarantee: if the process dies, the
  sweep re-dispatches. Best for single-instance Node and Cloudflare Workers,
  where standing up a broker is overkill.
- **queue**: add `AlephaApiJobsQueue` and dispatch goes through a real broker
  (Cloudflare Queues, Redis) so a worker pool consumes the work.

```typescript
import { AlephaApiJobs, AlephaApiJobsQueue } from "alepha/api/jobs";

alepha.with(AlephaApiJobs).with(AlephaApiJobsQueue);
```

Both modes are at-least-once. Write handlers to be idempotent.

## Retention

Queue-mode jobs default to `record: "error"` - the pending row is written at
push time and removed on success, so a healthy queue leaves no rows behind.
Cron jobs default to `record: "all"` with one retained success so the admin
"Last run" column is accurate.

| Setting               | Effect                                             |
| --------------------- | -------------------------------------------------- |
| `record: "error"`     | Keep error and cancelled rows only (queue default) |
| `record: "all"`       | Keep successes too, trimmed to `keepLastSuccess`   |
| `record: "none"`      | Fire-and-forget, no row even on error              |
| `keep: { ok, error }` | Per-job override. `0` here means **keep forever**  |

Note the deliberate asymmetry: per-job `keep.ok: 0` means _never trim_, while
the global `keepLastSuccess: 0` means _delete on success_.

## Configuration

Tune the `jobConfig` atom:

```typescript
import { jobConfig } from "alepha/api/jobs";

alepha.store.mut(jobConfig, (c) => ({ ...c, sweepCron: "*/5 * * * *" }));
```

**Mutate before you wire the module.** A cron expression is read once, when the
`$job` field initializes, and wiring a module injects its services immediately.
A mut applied after the module is wired lands in the store but never reaches the
already-registered cron - no error, no effect:

```typescript
// Works - the store is set before anything reads it.
const alepha = Alepha.create();
alepha.store.mut(jobConfig, (c) => ({ ...c, sweepCron: "*/5 * * * *" }));
alepha.with(MyApp);

// Silently does nothing to the schedule.
const alepha = Alepha.create().with(MyApp);
alepha.store.mut(jobConfig, (c) => ({ ...c, sweepCron: "*/5 * * * *" }));
```

Inside a `$module`, the `register()` hook runs before `imports[]` and
`services[]`, so it is also a safe place to do this.

| Key                    | Default        | Description                                                                                           |
| ---------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `sweepCron`            | `*/15 * * * *` | Reconciliation sweep - bounds retry latency                                                           |
| `trimCron`             | `0 * * * *`    | Ring-buffer trim tick                                                                                 |
| `sweepBatchSize`       | `200`          | Rows one sweep phase reads per tick - see below                                                       |
| `maxRedispatch`        | `3`            | Lost deliveries tolerated before a `pending` row is failed                                            |
| `retryBackoffBase`     | `5000`         | First retry's backoff ceiling (ms); doubles per attempt, full jitter                                  |
| `retryBackoffMax`      | `1800000`      | Ceiling for that curve (ms)                                                                           |
| `staleThreshold`       | `300000`       | Pending age (ms) before the sweep re-dispatches                                                       |
| `runTimeout`           | `1800000`      | Running age (ms) before a crash is assumed                                                            |
| `keepLastSuccess`      | `10`           | Successful rows kept per job                                                                          |
| `keepLastError`        | `10`           | Error rows kept per job                                                                               |
| `drainTimeout`         | `30000`        | Time (ms) to wait for in-flight jobs on shutdown                                                      |
| `logMaxEntries`        | `100`          | Log lines captured per run                                                                            |
| `directMaxConcurrency` | `10`           | Concurrent handlers in direct mode - what keeps a `pushMany` of thousands from exhausting the DB pool |

### The sweep is bounded

Each sweep phase reads at most `sweepBatchSize` rows per tick and leaves the
rest for the next one. This matters under exactly the conditions where the
sweep is load-bearing: a downstream outage turns the entire retrying
population into rows the sweep matches at once, and every row carries its
payload and any captured logs. A phase that fills its batch logs that it did,
so a backlog is visible in the logs rather than something you infer from a
graph.

Every phase's action moves the row out of the status that phase owns, so
progress across ticks is guaranteed. What repeats is the **priority**
ordering: while a backlog persists, newly arriving `critical` work is served
before `low` work that has been waiting. That is what `$job` priority means,
and it is the only thing it means.

A `pending` row whose delivery is lost is re-dispatched at most
`maxRedispatch` times before it is failed. This is counted separately from
`attempt`, which only moves when a worker actually claims the row: a payload
that kills the process between dispatch and claim never increments `attempt`,
so the retry policy would never end it.

### Sweeps owned by other modules

Modules that ship their own crons expose them the same way. All default to
`*/15 * * * *` so they collapse onto the jobs sweep's trigger instead of adding
their own - which matters on Cloudflare, where each distinct expression costs a
Cron Trigger.

| Atom                                           | Key                      | Default        | Bounded by                                           |
| ---------------------------------------------- | ------------------------ | -------------- | ---------------------------------------------------- |
| `workflowConfig` (`alepha/api/workflows`)      | `timeoutCron`            | `*/15 * * * *` | How late a workflow's `timeout` is enforced          |
|                                                | `recoveryCron`           | `*/15 * * * *` | `recovery.staleThreshold` (30 min)                   |
|                                                | `purgeCron`              | `0 3 * * *`    | `retentionDays`                                      |
| `paymentsConfig` (`alepha/api/payments`)       | `expireStaleIntentsCron` | `*/15 * * * *` | The 30-minute intent cutoff                          |
| `checkoutConfig` (`@alepha/commerce/checkout`) | `stockSweepCron`         | `*/15 * * * *` | Nothing - `reserved()` excludes holds by `expiresAt` |

`timeoutCron` is the one to reconsider if you rely on tight workflow deadlines:
a workflow past its deadline keeps running until the next tick, so a 15-minute
tick can let a workflow with a 5-minute timeout run for 20. Set it to
`* * * * *` if deadlines must bite promptly, and accept the extra trigger.

## Multi-replica deployments

Cron-mode jobs take a distributed lock per tick (`lock: true` by default), so a
fleet of replicas fires the handler once, not once per replica. This needs a
real `LockProvider` - the default `MemoryLockProvider` is per-process. See
[Bare metal deployment](/docs/guides-deployment-bare) for the setup.

The unit that is claimed is the **schedule instant**, not the job. Every replica
derives the same instant from the same cron expression, so the first one there
claims it and the others stand down - including a replica whose clock lags by a
few milliseconds and arrives after the handler has already finished. That claim
is what makes "once per tick" hold for a job with `retry`, where the tick only
writes an outbox row and is over in a millisecond.

A manual `trigger()` is not a scheduled instant, so it is never suppressed by
one; it still takes the per-job lock, and so cannot overlap a running tick.

`lock` has no effect on queue-mode and direct-mode jobs. Those serialize through
the outbox `claim()` UPDATE-guard instead, which is always on.

## Events

`$job` emits lifecycle events you can hook:

| Event         | Payload                        |
| ------------- | ------------------------------ |
| `job:begin`   | `{ name, now, executionId }`   |
| `job:success` | `{ name, executionId }`        |
| `job:error`   | `{ name, error, executionId }` |
| `job:cancel`  | `{ name, executionId }`        |
| `job:end`     | `{ name, executionId }`        |

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

  You get the tick, but no distributed lock - on multiple replicas every
  replica fires - no run history, no retry and
  nothing in the admin UI. Reach for it only when a database is genuinely
  unavailable.

- **Fan-out to many subscribers.** Use `$topic` / `$subscriber`, which is
  publish/subscribe rather than work distribution.
