# Alepha - Scheduler

## Installation

Part of the `alepha` package. Import from `alepha/scheduler`.

```bash
npm install alepha
```

## Overview

Cron and interval-based task execution.

**Features:**
- Scheduled tasks with cron expressions (e.g., `0 0 * * *`)
- Interval-based scheduling
- Distributed locking to prevent duplicate execution
- Lifecycle hooks: `begin`, `success`, `error`, `end`

## API Reference

### Primitives

- [`$scheduler`](/docs/reference-primitives-$scheduler) — Scheduler primitive.

### Providers

- [`WorkerdCronProvider`](/docs/reference-providers-workerdcronprovider) — Cloudflare Workers cron provider.
