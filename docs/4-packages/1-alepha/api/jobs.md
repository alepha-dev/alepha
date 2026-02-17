# Alepha - Api Jobs

## Installation

Part of the `alepha` package. Import from `alepha/api/jobs`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.9.0 | node, bun, workerd |

Job execution framework — unified primitive for deferred, scheduled, and queued work.

**Features:**
- Push-based jobs with typed payloads
- Cron scheduling with execution tracking
- Retry with exponential backoff
- Priority, delay, cancellation
- Deduplication via unique keys
- Per-execution log capture

## API Reference

### Primitives

- [`$job`](/docs/reference-primitives-$job) — Job primitive for defining scheduled and on-demand tasks with payload validation, retry policies, and batching.
