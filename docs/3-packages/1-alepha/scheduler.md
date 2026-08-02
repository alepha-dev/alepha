# Alepha - Scheduler

## Installation

Part of the `alepha` package. Import from `alepha/scheduler`.

```bash
npm install alepha
```

## Overview

Cron tick engine used under `$job`. **Not an application-facing API.**

There is no scheduler primitive. Declare scheduled work with
`$job({ cron })` (`alepha/api/jobs`), which registers here and adds the
things a bare tick lacks: run history, retries, timeouts and an admin view.

`CronProvider` remains the single registry of cron expressions — the
the Cloudflare build reads it to emit native platform triggers.
Register a cron directly with `CronProvider.createCronJob()` if you need a
tick without a database.

**Features:**
- Cron expression scheduling (e.g., `0 0 * * *`)
- Serverless cron dispatch via the `serverless:cron` hook (Cloudflare, generic)

For distributed locking and retries around scheduled work, use `$job({ cron })`
from `alepha/api/jobs` — it layers durability on top of this scheduler.

## API Reference

### Providers

- [`WorkerdCronProvider`](/docs/reference-providers-workerdcronprovider) — Cloudflare Workers cron provider.
