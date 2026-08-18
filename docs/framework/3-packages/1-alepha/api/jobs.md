# Alepha - Api Jobs

## Installation

Part of the `alepha` package. Import from `alepha/api/jobs`.

```bash
npm install alepha
```

## Overview

Job execution framework — cron and durable queue work with a single primitive.

A `$job` is either **cron-only** (declares `cron`) or **payload-only** (declares `schema`).

**Three runtime modes:**

- **cron** — fires on a schedule. Cron-mode jobs are protected by a
  distributed lock by default (`lock: true`), so multi-replica Docker
  deployments only run the handler once per tick. Override with
  `lock: false` if you genuinely want every replica to fire.
- **queue** — push-driven, dispatched through the queue infrastructure
  (`AlephaQueue`, e.g. Cloudflare Queues, Redis). Real-time delivery,
  ideal for high-volume systems. Requires `AlephaApiJobsQueue`.
- **direct** — push-driven, processed in-process right after the caller
  awaits the push. The DB outbox row is the durability guarantee — if
  the process dies, the reconciliation sweep re-dispatches. Default
  when `AlephaApiJobsQueue` is *not* loaded. Best for cheap deployments
  (Cloudflare Workers, single-instance Node) where standing up a queue
  is overkill.

**Retries** are sweep-driven across all modes (no exponential backoff).
Granularity is bounded by `sweepCron` (default 15 min). The first retry
may land anywhere from a few seconds to ~15 min later depending on when
the next sweep tick fires. Cron jobs that declare `retry` go through
the same sweep path — a transient failure no longer means waiting for
the next cron tick (useful for once-daily jobs).

**Runtime support for cron triggers**

- **Long-running Node / Docker** — `CronProvider` runs an in-process
  timer loop. Multi-replica deployments serialize ticks via the cron
  lock (see `$job.lock`).
- **Cloudflare Workers** — the build emits cron expressions into
  `wrangler.jsonc`; Cloudflare invokes the worker on schedule and the
  `cloudflare:scheduled` hook routes the event to the matching jobs.
- **Generic serverless** — a platform entry point can POST
  `/_alepha/cron/:name`; the handler emits `serverless:cron` and
  `CronProvider` runs the matching job. Set `CRON_SECRET` to require
  authenticated calls.

## API Reference

### Primitives

- [`$job`](/docs/reference-primitives-$job) — Job primitive for defining scheduled (cron) or queued (push) tasks.

### Providers

- [`DirectJobDispatcher`](/docs/reference-providers-directjobdispatcher) — Default `JobDispatcher` for environments without `AlephaApiJobsQueue`.
- [`JobProvider`](/docs/reference-providers-jobprovider) — Coordinates cron and push jobs with a durable outbox table and a single
- [`JobQueueProvider`](/docs/reference-providers-jobqueueprovider) — Queue-backed `JobDispatcher` registered by `AlephaApiJobsQueue`.
