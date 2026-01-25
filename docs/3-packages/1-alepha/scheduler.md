# Alepha - Scheduler

## Installation

Part of the `alepha` package. Import from `alepha/scheduler`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

Cron and interval-based task execution.

**Features:**
- Scheduled tasks with cron expressions (e.g., `0 0 * * *`)
- Interval-based scheduling
- Distributed locking to prevent duplicate execution
- Lifecycle hooks: `begin`, `success`, `error`, `end`

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $scheduler()

Scheduler primitive.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SCHEDULER_PREFIX` | text | - | Prefix store key |
