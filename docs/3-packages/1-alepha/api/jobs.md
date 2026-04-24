# Alepha - Api Jobs

## Installation

Part of the `alepha` package. Import from `alepha/api/jobs`.

```bash
npm install alepha
```

## Overview

Job execution framework — cron and durable queue work with a single primitive.

A `$job` is either **cron-only** (declares `cron`) or **queue-only** (declares `schema`).
Cron jobs run inline on their schedule and only record errors by default.
Queue jobs use the outbox pattern: push commits to DB first, then notifies via queue.

**This module provides cron support only.** To enable queue-mode jobs, also
import {@link AlephaApiJobsQueue} — it brings in the queue layer and infrastructure
binding (e.g. Cloudflare Queues). Cron-only deployments (Vercel, CF-without-Queues)
do not need `AlephaApiJobsQueue`.

## API Reference

### Primitives

- [`$job`](/docs/reference-primitives-$job) — Job primitive for defining scheduled (cron) or queued (push) tasks.

### Providers

- [`JobProvider`](/docs/reference-providers-jobprovider) — Coordinates cron (scheduler) and queue (push) jobs with a durable outbox
- [`JobQueueProvider`](/docs/reference-providers-jobqueueprovider) — Plumbs outbox-style dispatch through `AlephaQueue`.
