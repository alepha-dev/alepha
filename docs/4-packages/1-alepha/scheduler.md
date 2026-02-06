# Alepha - Scheduler

## Installation

Part of the `alepha` package. Import from `alepha/scheduler`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.1.0 | node, bun, workerd|

Cron and interval-based task execution.

**Features:**
- Scheduled tasks with cron expressions (e.g., `0 0 * * *`)
- Interval-based scheduling
- Distributed locking to prevent duplicate execution
- Lifecycle hooks: `begin`, `success`, `error`, `end`

## API Reference

### Primitives

- [`$scheduler`](/docs/primitives-$scheduler) — Scheduler primitive.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### WorkerdCronProvider

Cloudflare Workers cron provider.

This provider handles scheduled events from Cloudflare Workers Cron Triggers.
Unlike the Node.js CronProvider, this doesn't use intervals/timeouts - instead,
it reacts to scheduled events triggered by Cloudflare.

**Usage:**
1. Define schedulers with `$scheduler({ cron: "0 * * * *", handler: ... })`
2. Build your app with `alepha build` - cron triggers are automatically added to `wrangler.jsonc`
3. Deploy to Cloudflare Workers

**How it works:**
- During build, all registered `$scheduler` cron expressions are collected
- The build generates `wrangler.jsonc` with `triggers.crons` automatically filled
- When Cloudflare fires a cron trigger, the `scheduled` handler emits `cloudflare:scheduled`
- This provider listens to that event and runs matching schedulers

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SCHEDULER_PREFIX` | text | - | Prefix store key |
