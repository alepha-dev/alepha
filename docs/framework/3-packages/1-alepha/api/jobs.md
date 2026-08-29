# Alepha - Api Jobs

## Installation

Part of the `alepha` package. Import from `alepha/api/jobs`.

```bash
npm install alepha
```

## Overview

Job execution framework - cron and durable queue work with a single primitive.

A `$job` is either **cron-only** (declares `cron`) or **payload-only** (declares `schema`).

**Three runtime modes:**

- **cron**: fires on a schedule. Cron-mode jobs are protected by a
  distributed lock by default (`lock: true`), so multi-replica Docker
  deployments only run the handler once per tick. Override with
  `lock: false` if you genuinely want every replica to fire.
- **queue**: push-driven, dispatched through the queue infrastructure
  (`AlephaQueue`, e.g. Cloudflare Queues, Redis). Real-time delivery,
  ideal for high-volume systems. Requires `AlephaApiJobsQueue`.
- **direct**: push-driven, processed in-process right after the caller
  awaits the push. The DB outbox row is the durability guarantee - if
  the process dies, the reconciliation sweep re-dispatches. Default
  when `AlephaApiJobsQueue` is _not_ loaded.

**Direct mode is a different reliability contract on Cloudflare, not
just the cheaper option.** On long-running Node it is genuinely equivalent
to queue mode minus the broker. On Workers it is not: `DirectJobDispatcher`
keeps the isolate alive through `executionCtx.waitUntil`, which Cloudflare
caps at about **30 seconds after the response**. That is the whole budget a
job pushed from a request gets, a declared `timeout` longer than it is
unreachable, and because crash recovery is derived as twice the declared
timeout, a job killed at the budget sits `running` for twice its timeout
before the sweep will consider it crashed. A local timer armed after the
response never fires there either, so delayed work and retry backoff both
fall back to sweep granularity. The build warns about the timeouts it can
see; the rest is inherent.

**`AlephaApiJobsQueue` is the answer to all of that**, and the
recommended path for anything long-running or high-volume on Cloudflare: a
queue consumer gets 15 minutes of wall clock AND 15 minutes of CPU, the
most generous surface Cloudflare offers, and the transport can hold a
delayed message so retries land on their backoff rather than on the sweep.

**Retries** use exponential backoff with full jitter (`retryBackoffBase`,
`retryBackoffMax`). The outbox row's `scheduledAt` is the truth and the
sweep is the backstop, so what varies by runtime is only how soon anything
looks at it: exactly, on Node in either dispatch mode and on Workers behind
a queue; at the next `sweepCron` tick in direct mode on Workers. Cron jobs
that declare `retry` go through the same outbox path - a transient failure
no longer means waiting for the next cron tick (useful for once-daily
jobs). For a payload that expires before any of that, `push(payload,
{ inline: true })` runs the handler in front of the caller and fails
terminally instead of retrying.

**Cloudflare budgets, in one place:**

|                                            |                                                   |
| ------------------------------------------ | ------------------------------------------------- |
| `waitUntil` after a response (direct mode) | ~30 s                                             |
| Cron Trigger wall clock                    | 15 min                                            |
| Cron Trigger CPU                           | 30 s under an hourly interval, 15 min at or above |
| Queue consumer                             | 15 min wall AND 15 min CPU                        |
| Cron Triggers per **account**              | 5 free, 250 paid                                  |

The last one is per account rather than per Worker, so two Alepha apps can
exceed it between them. The build warns past five and names the
expressions; the fix is to give jobs that do not need their own cadence a
shared one.

**Runtime support for cron triggers**

- **Long-running Node / Docker**: `CronProvider` runs an in-process
  timer loop. Multi-replica deployments serialize ticks via the cron
  lock (see `$job.lock`).
- **Cloudflare Workers**: the build emits cron expressions into
  `wrangler.jsonc`; Cloudflare invokes the worker on schedule and the
  `cloudflare:scheduled` hook routes the event to the matching jobs.
- **Generic serverless**: a platform entry point can POST
  `/_alepha/cron/:name`; the handler emits `serverless:cron` and
  `CronProvider` runs the matching job. Set `CRON_SECRET` to require
  authenticated calls.

## API Reference

### Primitives

- [`$job`](/docs/reference-primitives-$job) - Job primitive for defining scheduled (cron) or queued (push) tasks.

### Providers

- [`DirectJobDispatcher`](/docs/reference-providers-directjobdispatcher) - Default `JobDispatcher` for environments without `AlephaApiJobsQueue`.
- [`JobDispatcher`](/docs/reference-providers-jobdispatcher) - Abstract dispatcher for queued/direct job executions.
- [`JobProvider`](/docs/reference-providers-jobprovider) - Coordinates cron and push jobs with a durable outbox table and a single
- [`JobQueueProvider`](/docs/reference-providers-jobqueueprovider) - Queue-backed `JobDispatcher` registered by `AlephaApiJobsQueue`.
