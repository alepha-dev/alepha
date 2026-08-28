# JobProvider

## Import

```typescript
import { JobProvider } from "alepha/api/jobs";
```

## Overview

Coordinates cron and push jobs with a durable outbox table and a single
reconciliation sweep. The actual delivery channel (queue / direct) is
abstracted behind `JobDispatcher`, substituted by DI:

- **DirectJobDispatcher** (default, registered by `AlephaApiJobs`) -
  runs the handler in-process right after `push()` returns.
- **QueueJobDispatcher** (registered by `AlephaApiJobsQueue`): sends
  the executionId through `AlephaQueue` so a pool of workers can pick
  it up.

Push flow:
push() → INSERT row (pending) → dispatcher.dispatch(jobName, id)
worker → claim → UPDATE running → handler → DELETE/UPDATE on success
→ UPDATE error / scheduled (retry) on failure

Cron flow:
scheduler tick → claim the instant → acquire lock → executeInline (no retry)
→ enqueue + dispatch (retry declared)

Sweep responsibilities (every `sweepCron`), one per status, declared in
`sweepTable()`:

- `scheduled` with `scheduledAt <= now` → pending + dispatch
- `pending` untouched for `staleThreshold` → re-dispatch
- `running` past its lease → failed, then the retry policy

Trim runs on its own cron (`trimCron`, default hourly):

- per-job history trimmed beyond `keepLastSuccess` / `keepLastError`
- decoupled from sweep because trim cost scales with job count, not
  retry latency - running it every sweep is wasted work for most apps.
