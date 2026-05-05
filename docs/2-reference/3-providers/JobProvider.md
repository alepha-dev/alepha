# JobProvider

## Import

```typescript
import { JobProvider } from "alepha/api/jobs";
```

## Overview

Coordinates cron (scheduler) and queue (push) jobs with a durable outbox
table and a single reconciliation sweep.

Queue-mode flow:
  push()  → INSERT row (pending) + queue.send({ executionId })
  worker  → SELECT row → UPDATE running → handler → DELETE (ok) / UPDATE (error)

Cron-mode flow:
  scheduler tick → handler runs inline → INSERT row only on error

Sweep responsibilities (every `sweepCron`):
  - re-enqueue pending rows older than `staleThreshold`
  - fail running rows older than `max(timeout*2, runTimeout)`
  - move `scheduled` rows with `scheduledAt <= now` to pending + enqueue
  - trim per-job history beyond `keepLastSuccess` / `keepLastError`

