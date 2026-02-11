# `$job` Primitive — V2 Specification


## 1. Overview

`$job` v2 is a unified primitive for deferred, scheduled, and queued work in Alepha. It merges the concepts of `$scheduler` (cron), `$queue` (async dispatch), `$batch` (grouped processing), and `$retry` (fault tolerance) into a single, database-backed primitive.

Every job execution is persisted to the database before dispatch. A crash between push and execution never loses work.

### 1.1 Design Principles

- **Transactional safety.** Every job is written to the database before it is dispatched to the queue layer. No work is ever lost.
- **Zero-mapping.** The payload schema is defined once with TypeBox and flows through push, persistence, and handler without manual mapping.
- **Convention-driven.** Jobs declared as class properties are auto-registered. The primitive binds `this` to the owning class instance at init time, so handlers have full access to sibling properties. The CLI can list, trigger, and inspect them.
- **DI-native.** Jobs have full access to Alepha's dependency injection via `$inject`.
- **Composable.** Built on top of existing primitives (`$queue`, `$batch`) and providers (`CronProvider`, `LockProvider`) — not a parallel reimplementation.
- **Multi-runtime.** Core logic runs on Node.js, Bun, and Cloudflare Workers. The queue backend is pluggable.

---

## 2. API

### 2.1 Job Definition

`$job` must be used as a **class property**. The primitive captures `this` from the owning class during `onInit()`, so the handler has access to all sibling `$inject` / `$logger` / `$repository` properties.

```ts
import { $job } from "alepha/api/jobs"
import { $inject, $logger, t } from "alepha"

class UserJobs {
  protected readonly users = $inject(UserRemote)
  protected readonly mailer = $inject(Mailer)
  protected readonly log = $logger()

  purgeUser = $job({
    // --- Payload schema (TypeBox) ---
    schema: t.object({
      userId: t.uuid(),
      reason: t.optional(t.text()),
    }),

    // --- Retry policy (optional) ---
    retry: {
      retries: 3,                                // number of retries after first failure (default: 0 = no retry)
      backoff: {
        initial: [5, "second"],                  // base delay between retries
        factor: 2,                               // exponential multiplier
        max: [5, "minute"],                      // cap for exponential backoff
        jitter: true,                            // add randomness to prevent thundering herd
      },
    },

    // --- Timeout (optional) ---
    timeout: [10, "minute"],                     // max execution time per attempt, default: none

    // --- Concurrency (optional) ---
    concurrency: 5,                              // max parallel executions, default: 1

    // --- Consumer batching (optional) ---
    batch: {
      size: 100,                                 // process up to N items per handler call
      window: [1, "second"],                     // max wait before flushing a partial batch
    },

    // --- Priority (optional) ---
    priority: "normal",                          // "critical" | "high" | "normal" | "low"

    // --- Handler ---
    handler: async ({ items, now }) => {
      // now: DateTime — always present
      // items: JobItem[] — always an array:
      //   cron-only job  → []
      //   single push    → [{ id, payload, attempt }]
      //   batched        → [{ id, payload, attempt }, ...]
      for (const item of items) {
        await this.users.delete(item.payload.userId)
        this.log.info("User purged", { userId: item.payload.userId })
      }
    },
  })
}
```

### 2.2 Cron-Style Job

When `cron` is set, the job self-triggers on a schedule. No `.push()` call is needed. The `schema` is optional for cron-only jobs — when omitted, `items` is always `[]`.

```ts
class ReportJobs {
  protected readonly reports = $inject(ReportService)
  protected readonly log = $logger()

  dailyReport = $job({
    cron: "0 8 * * 1-5",                        // weekdays at 08:00
    lock: true,                                  // default: true — single execution across cluster

    retry: {
      retries: 2,
      backoff: [1, "minute"],                    // fixed backoff shorthand
    },

    handler: async ({ now }) => {
      // items is [] for cron-triggered executions
      await this.reports.generateDaily(now)
      this.log.info("Daily report generated")
    },
  })
}
```

Cron jobs and push-based jobs can coexist on the same `$job` definition. The `cron` option simply auto-pushes on the schedule.

**Cron creates execution records.** Every cron tick inserts a `job_executions` row, just like a manual push. This gives full execution history, duration tracking, error capture, and log storage for every scheduled run. This is the same approach as Oban and pg-boss — the execution record is the audit trail.

For a `*/15 * * * *` job, that's ~96 rows/day, cleaned up by the log purge sweep (section 5.3) after `logRetentionDays`. Cron-triggered rows have no `payload` (unless the job also accepts push) and `triggeredBy` is recorded as `"system (cron)"`.

### 2.3 Pushing Jobs

`.push()` takes a single payload (or an array of payloads) as the first argument, and optional options as the second. No ambiguity between payload and options.

```ts
// --- Single push ---
await this.purgeUser.push({ userId: "abc-123", reason: "gdpr" })

// --- Single push with options ---
await this.purgeUser.push(
  { userId: "abc-123" },
  {
    delay: [1, "hour"],                          // relative delay
    key: "purge_abc-123",                        // unique constraint (see section 4.6)
    priority: "high",                            // override job-level default
    scheduledAt: new Date("2026-04-15"),         // absolute datetime (alternative to delay)
  },
)

// --- Batch push (single DB insert, same options for all) ---
await this.purgeUser.push([
  { userId: "user-1" },
  { userId: "user-2" },
  { userId: "user-3" },
])
```

When pushing an array, all items share the same options (second argument). For per-item options, use `.pushMany()`:

```ts
// --- Batch push with per-item options ---
await this.purgeUser.pushMany([
  { payload: { userId: "user-1" }, key: "purge_1" },
  { payload: { userId: "user-2" }, key: "purge_2", delay: [30, "minute"] },
])
```

`.pushMany()` always uses the explicit `{ payload, ...options }` wrapper. This avoids any ambiguity — the `payload` key is part of the wrapper, not the schema.

### 2.4 Cancellation

Running or pending jobs can be cancelled. The cancelling user is tracked via the `user` atom.

```ts
// Cancel a specific execution by ID
await this.purgeUser.cancel(executionId)

// Cancel via admin endpoint
// POST /api/jobs/executions/:id/cancel
```

When a job is cancelled:
- If `pending` or `scheduled`: status transitions to `cancelled` immediately.
- If `running`: an `AbortSignal` is triggered on the handler context. The handler should check `signal.aborted` for cooperative cancellation. Status transitions to `cancelled` once the handler exits.

The handler receives the signal:

```ts
handler: async ({ items, now, signal }) => {
  for (const item of items) {
    if (signal.aborted) break
    await this.processItem(item.payload)
  }
}
```

The cancelling user is recorded in the execution:

```ts
// cancelledBy and cancelledByName are populated from the current user atom
```

### 2.5 Transactional Push

Push jobs atomically within a database transaction.

```ts
class UserService {
  protected readonly users = $repository(userEntity)
  protected readonly purgeUser = $inject(UserJobs).purgeUser

  deleteUser = $transaction({
    handler: async (tx, userId: string) => {
      await this.users.deleteById(userId, { tx })
      await this.purgeUser.push({ userId }, { tx })
    },
  })
}
```

### 2.6 Manual Trigger (Admin / CLI)

Jobs can be triggered manually via the admin API or CLI. For push-based jobs, a payload can be provided. For cron-only jobs (no schema), no payload is needed.

```ts
// Trigger a cron-only job (no payload)
await this.dailyReport.trigger({
  triggeredBy: user.id,
  triggeredByName: user.name,
})

// Trigger a push-based job with payload
await this.purgeUser.trigger({
  payload: { userId: "abc-123", reason: "manual" },
  triggeredBy: user.id,
  triggeredByName: user.name,
})

// HTTP — POST /api/jobs/trigger
// { "name": "UserJobs.purgeUser", "payload": { "userId": "abc-123" } }
// CLI  — alepha jobs trigger UserJobs.purgeUser --payload '{"userId":"abc-123"}'
```

When `schema` is defined, the payload is validated against the schema before execution. When `schema` is not defined (cron-only), `payload` must be omitted.

---

## 3. Architecture

### 3.1 Dual-Layer Design

```
                  +----------------------------------------------+
                  |               Application                    |
                  |                                              |
                  |   job.push(payload) --> Schema validate      |
                  +-------------------+------------------+-------+
                                      |                  |
                  +-------------------v------------------+-------+
                  |          Storage Layer (Source of Truth)      |
                  |                                              |
                  |   PostgreSQL / SQLite                         |
                  |   +-------------------------------------+    |
                  |   |  job_executions entity                |    |
                  |   |  status: pending -> running ->        |    |
                  |   |          completed / failed / dead    |    |
                  |   +-------------------------------------+    |
                  +-------------------+------------------+-------+
                                      |                  |
                  +-------------------v------------------+-------+
                  |          Queue Layer (Dispatch)               |
                  |                                              |
                  |   Redis / Cloudflare Queue / In-Memory       |
                  |   Fast FIFO with optional delay support      |
                  +-------------------+------------------+-------+
                                      |                  |
                  +-------------------v------------------+-------+
                  |          Worker / Consumer                    |
                  |                                              |
                  |   Poll queue -> Claim job (UPDATE WHERE) ->  |
                  |   Execute handler() -> Update status         |
                  +----------------------------------------------+
```

### 3.2 How It Uses Existing Primitives

| Concern | Built On | Notes |
| --- | --- | --- |
| Async dispatch | `QueueProvider` (`$queue` internals) | Redis, Memory, or DB-only polling |
| Cron triggers | `CronProvider` (`$scheduler` internals) | Reuses cron parsing + lifecycle |
| Handler retries | DB-level rescheduling | Increment attempt, compute next `scheduledAt`, set status to `scheduled` |
| Batch consumption | `BatchProvider` (`$batch` internals) | Size + time window flush |
| Distributed lock | `LockProvider` (`$lock`) | For cron single-execution and concurrency |
| DB persistence | `Repository<jobExecutionEntity>` | Standard Alepha ORM |
| Log capture | `Logger` + `"log"` event | Captures `LogEntry` objects per execution context ID, capped at `logMaxEntries` |

### 3.3 Queue Backends

| Backend | Use Case | Delay Support | Priority Support |
| --- | --- | --- | --- |
| In-memory (`MemoryQueueProvider`) | Development, testing | Yes (timers) | Yes |
| Redis (`RedisQueueProvider`) | Production, Node/Bun | Yes (sorted sets) | Yes |
| Cloudflare Queues | Edge, CF Workers | Limited | No |
| DB-only (polling) | Simple deployments | Yes (query) | Yes |

The queue layer is **advisory**. If Redis is down, the recovery sweep (section 5.1) picks up unprocessed items from the DB via polling.

---

## 4. Behaviors

### 4.1 Write Batching

When multiple `.push()` calls happen within a short window, they are buffered and flushed as a single `INSERT ... VALUES` statement. This uses the same `BatchProvider` internals as `$batch`.

| Config Key | Default | Description |
| --- | --- | --- |
| `batchWindow` | `10ms` | Max time to buffer before flushing |
| `batchMaxSize` | `1000` | Max items per flush |
| `flush: "immediate"` | | Per-push option to bypass batching |

```ts
const { id } = await job.push(payload, { flush: "immediate" })
return { jobId: id } // return to API caller in same request cycle
```

### 4.2 Consumer Batching

When `batch` is configured on the job definition, the worker groups queued items and invokes `handler()` once per batch.

```ts
emailBlast = $job({
  schema: t.object({ to: t.email(), subject: t.text(), body: t.text() }),
  batch: { size: 100, window: [1, "second"] },

  handler: async ({ items, now }) => {
    // items: Array<{ id, payload, attempt }>
    const emails = items.map((item) => buildEmail(item.payload))
    await this.mailer.sendBulk(emails)
  },
})
```

The batch waits up to `batch.window` for `batch.size` items to accumulate. If the window expires with fewer items, a partial batch is processed.

**Batch failure semantics.** When a batched handler throws, **all items in the batch are treated as failed** and retry together as a group. There is no partial acknowledgment — the batch is atomic. This is the same model as Oban Pro and BullMQ Pro's default behavior.

This means **batched handlers must be idempotent.** If a batch of 50 emails fails on email #37, all 50 will retry on the next attempt — including the 36 that already succeeded. Design handlers to tolerate re-execution (e.g., use idempotency keys, check "already sent" state, or use database upserts).

If per-item granularity is needed, don't use `batch`. Push individual jobs and let the framework handle each independently — each gets its own retry lifecycle.

### 4.3 Retry Policy

On failure, the job is **rescheduled at the database level**. A new `scheduledAt` is computed from the backoff config, and the status is set back to `scheduled`. The delayed dispatch sweep (section 5.2) picks it up when the time arrives.

This is durable — retries survive crashes, restarts, and deployments.

| Option | Default | Description |
| --- | --- | --- |
| `retry.retries` | `0` | Number of retries after the first failure (0 = no retry, 3 = up to 4 total attempts) |
| `retry.backoff` | `{ initial: [1, "second"], factor: 2, max: [1, "minute"], jitter: true }` | Backoff strategy |
| `retry.when` | `() => true` | Predicate — only retry when this returns true |

| Backoff Style | Example Config | Delay Sequence |
| --- | --- | --- |
| Fixed | `backoff: [5, "second"]` | 5s, 5s, 5s, ... |
| Exponential | `backoff: { initial: [1, "second"], factor: 2 }` | 1s, 2s, 4s, 8s, ... |
| Exponential capped | `backoff: { initial: [1, "second"], factor: 2, max: [30, "second"] }` | 1s, 2s, 4s, 8s, 16s, 30s, 30s, ... |

After all retry attempts are exhausted, the job transitions to `dead` status and remains in the DB for inspection.

### 4.4 Timeout

When `timeout` is set on a job definition, each attempt is aborted if it exceeds the duration. The handler's `signal` is triggered on timeout, and the attempt is treated as a failure (retry policy applies).

```ts
importData = $job({
  schema: t.object({ fileId: t.uuid() }),
  timeout: [5, "minute"],
  retry: { retries: 2, backoff: [30, "second"] },

  handler: async ({ items, signal }) => {
    for (const item of items) {
      if (signal.aborted) break
      await this.importFile(item.payload.fileId)
    }
  },
})
```

Timeout is enforced via `AbortSignal.timeout()`. The same `signal` is used for both timeout and cancellation.

### 4.5 Priority

Jobs are dequeued in priority order:

| Priority | Numeric | Use Case |
| --- | --- | --- |
| `critical` | 0 | Payment webhooks, security alerts |
| `high` | 1 | User-facing notifications |
| `normal` | 2 | Standard background work (default) |
| `low` | 3 | Cleanup, analytics, reporting |

Priority can be set at the job level (default for all pushes) or overridden per push.

### 4.6 Unique Jobs (Deduplication)

When `key` is provided, only one job with that key can exist in `pending`, `scheduled`, or `running` state. Subsequent pushes with the same key are silently dropped and return the existing job ID.

```ts
await job.push({ userId: "abc" }, { key: "purge_abc" })
await job.push({ userId: "abc" }, { key: "purge_abc" }) // no-op, returns same ID
```

The uniqueness constraint is scoped to the job name. On completion, death, or cancellation the `key` column is set to `null`, so it no longer blocks new pushes.

### 4.7 Delayed & Scheduled Execution

Two mechanisms for deferred execution:

- **Relative delay:** `delay: [1, "hour"]` — executed at `now + duration`.
- **Absolute schedule:** `scheduledAt: new Date("2026-04-15")` — executed at the given datetime.

```ts
await job.push({ userId: "abc" }, { delay: [1, "hour"] })
await job.push({ userId: "abc" }, { scheduledAt: new Date("2026-04-15T09:00:00Z") })
```

Delayed jobs are stored with `scheduledAt` in the entity and status `scheduled`. They are dispatched to the queue layer only when their time arrives (via the sweep job, section 5.2).

### 4.8 Concurrency Control

`concurrency: N` limits how many instances of a specific job can run simultaneously across all workers. Enforced via `LockProvider` — the worker acquires a named lock slot before executing. If all slots are occupied, the job stays in the queue until a slot frees up.

---

## 5. Internal System Jobs

`$job` v2 uses itself to maintain its own health. These are registered automatically by the module.

### 5.1 Recovery Sweep

**Schedule:** Every 1 minute (configurable via `jobConfig`).

Scans the `job_executions` entity for jobs that are:
- `pending` and older than `staleThreshold` (default: 5 minutes) without being dispatched.
- `running` and assumed crashed: older than `max(job.timeout * 2, recovery.runTimeout)` without completion. When the job has a per-job `timeout`, the sweep uses `timeout * 2` as the crash threshold (giving the handler time to react to the AbortSignal). When no per-job timeout is set, the global `recovery.runTimeout` (default: 30 minutes) is used as a fallback.

Actions:
- Pending stale jobs: re-dispatch to queue.
- Running timed-out jobs: mark as `failed`, apply retry policy if attempts remain.

### 5.2 Delayed Dispatch Sweep

**Schedule:** Every 30 seconds (configurable via `jobConfig`).

Scans for jobs where `scheduledAt <= now` and `status = "scheduled"`. Moves them to `pending` and dispatches to the queue layer.

### 5.3 Log Purge

**Schedule:** Daily at 03:00 (configurable).

Deletes completed/dead/cancelled execution records older than `logRetentionDays` (default: 30 days).

---

## 6. Database Entities

### 6.1 Execution Entity

The job execution entity uses standard Alepha `$entity` patterns:

```ts
import { $entity, db } from "alepha/orm"
import { t } from "alepha"
import { logEntrySchema } from "alepha/logger"

export const jobExecutionEntity = $entity({
  name: "job_executions",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    jobName: t.text(),
    key: t.optional(t.text()),                              // set to null on completion/death/cancel

    payload: t.optional(t.record(t.text(), t.any())),       // JSONB, optional for cron-only jobs
    status: db.default(
      t.enum(["pending", "scheduled", "running", "completed", "failed", "dead", "cancelled"]),
      "pending",
    ),
    priority: db.default(t.integer({ minimum: 0, maximum: 3 }), 2),

    attempt: db.default(t.integer(), 0),                    // incremented at claim time (1 = first attempt)
    maxAttempts: db.default(t.integer(), 1),                // retries + 1 (1 = no retry)

    scheduledAt: t.optional(t.datetime()),                  // null = immediate
    startedAt: t.optional(t.datetime()),
    completedAt: t.optional(t.datetime()),

    result: t.optional(t.record(t.text(), t.any())),        // handler return value (if any)
    error: t.optional(t.text()),                            // error message + stack trace
    workerId: t.optional(t.text()),                         // hostname:pid:random — identifies which worker claimed this

    triggeredBy: t.optional(t.text()),                      // user ID (trigger)
    triggeredByName: t.optional(t.text()),                  // user display name (trigger)
    cancelledBy: t.optional(t.text()),                      // user ID (cancel)
    cancelledByName: t.optional(t.text()),                  // user display name (cancel)
  }),
  indexes: [
    { columns: ["jobName", "status", "priority", "scheduledAt"] },
    { columns: ["jobName", "status", "startedAt"] },
    { columns: ["jobName", "completedAt"] },
    { columns: ["jobName", "key"], unique: true, where: "key IS NOT NULL" },
  ],
})

export type JobExecutionEntity = Static<typeof jobExecutionEntity.schema>
```

### 6.2 Log Entity

Execution logs are stored in a **separate table** to keep the hot `job_executions` table lean. Logs are a cold read — only fetched when viewing execution detail in the admin UI.

```ts
import { $entity, db } from "alepha/orm"
import { t } from "alepha"
import { logEntrySchema } from "alepha/logger"

export const jobExecutionLogEntity = $entity({
  name: "job_execution_logs",
  schema: t.object({
    id: db.primaryKey(t.uuid()),                             // same as job_executions.id (1:1 relationship)
    logs: t.array(logEntrySchema),                           // LogEntry[], capped at logMaxEntries
  }),
})

export type JobExecutionLogEntity = Static<typeof jobExecutionLogEntity.schema>
```

The log row shares the same `id` as the execution row (1:1, not a FK — the log row is created on completion/failure and the purge sweep deletes both together). This means:

- **Hot table** (`job_executions`): small rows (~200 bytes), fast sweeps, fast dashboard queries, fast claim `UPDATE`
- **Cold table** (`job_execution_logs`): large rows (~50KB at cap), only read on detail view
- **No JOIN needed for list views** — logs are fetched separately when drilling into a specific execution
- **Purge is simple** — `DELETE FROM job_execution_logs WHERE id IN (SELECT id FROM job_executions WHERE completedAt < threshold)`

**Note on unique keys:** The `(jobName, key)` index is a **partial unique index** — `UNIQUE WHERE key IS NOT NULL`. This guarantees at the database level that only one active job with a given key can exist. On completion, death, or cancellation, the `key` column is set to `null`, which removes the row from the unique index and allows new pushes with the same key. On conflict (concurrent pushes with the same key), the second `INSERT` fails with a unique constraint violation, and the existing execution ID is returned. No application-level race condition possible.

**Note on attempt semantics:** `attempt` starts at 0 when the row is inserted (`pending`). It is incremented to 1 at claim time (before execution), so during the first execution `attempt = 1`. This makes the value human-readable: attempt 1 of 4 means "first try, up to 4 total." The job is marked `dead` when `attempt >= maxAttempts` and the retry predicate fails or retries are exhausted.

---

## 7. Provider: `JobProvider` v2

Central orchestrator for the v2 job lifecycle.

```ts
import { $inject, $hook, $logger, $use } from "alepha"
import { CronProvider } from "alepha/scheduler"
import { QueueProvider } from "alepha/queue"
import { BatchProvider } from "alepha/batch"
import { LockProvider } from "alepha/lock"

export class JobProvider {
  protected readonly alepha = $inject(Alepha)
  protected readonly config = $use(jobConfig)
  protected readonly cron = $inject(CronProvider)
  protected readonly queue = $inject(QueueProvider)
  protected readonly lock = $inject(LockProvider)
  protected readonly dt = $inject(DateTimeProvider)
  protected readonly log = $logger()
  protected readonly executions = $repository(jobExecutionEntity)

  /**
   * Register a job definition. Called by the $job primitive during onInit().
   */
  public registerJob(name: string, options: JobOptions): void { /* ... */ }

  /**
   * Push a single job execution to the database and dispatch to queue.
   */
  public async push(name: string, payload: unknown, options?: PushOptions): Promise<string> { /* ... */ }

  /**
   * Push multiple job executions in a single DB write, with per-item options.
   */
  public async pushMany(name: string, items: PushItem[]): Promise<string[]> { /* ... */ }

  /**
   * Cancel a running or pending execution.
   */
  public async cancel(executionId: string): Promise<void> { /* ... */ }

  /**
   * Claim and execute the next available job from the queue.
   */
  protected async processNext(name: string): Promise<void> { /* ... */ }

  /**
   * Execute a job handler with full lifecycle tracking.
   */
  protected async execute(execution: JobExecutionEntity, options: JobOptions): Promise<void> { /* ... */ }
}
```

### 7.1 Execution Lifecycle

1. **Push**: Validate payload against schema. Insert `job_executions` record with `attempt = 0`, `maxAttempts = retries + 1`, status `pending`. Dispatch job ID to queue layer.
2. **Claim**: Worker pops from queue. Atomically updates the DB row: `UPDATE ... SET status = 'running', attempt = attempt + 1, startedAt = now(), workerId = ? WHERE id = ? AND status = 'pending'`. If the row was already claimed (0 rows updated), skip it. After this step, `attempt = 1` for the first execution.
3. **Execute**: Run handler within `alepha.context.run()` with a unique context ID. Create `AbortSignal` from timeout + cancellation. Listen to `"log"` events and collect all `LogEntry` objects matching this context ID (capped at `logMaxEntries`).
4. **Complete**: Set status to `completed`, record `completedAt`. Write captured logs to `job_execution_logs`. Set `key` to `null`. Emit `job:success` event.
5. **Fail**: On error, check if `retry.when(error)` returns true and `attempt < maxAttempts`. If so, compute next `scheduledAt` from backoff config and set status to `scheduled`. If exhausted or `when` returns false, set status to `dead` and `key` to `null`. Emit `job:error` event.
6. **Cancel**: On cancellation, set status to `cancelled`, record `cancelledBy` / `cancelledByName` from the user atom, set `key` to `null`. Emit `job:cancel` event.
7. **Events**: Emit `job:begin` / `job:end` for all executions regardless of outcome.

### 7.2 Lifecycle Events

```ts
alepha.on("job:begin", ({ name, now, executionId }) => { /* ... */ })
alepha.on("job:success", ({ name, executionId }) => { /* ... */ })
alepha.on("job:error", ({ name, error, executionId }) => { /* ... */ })
alepha.on("job:cancel", ({ name, executionId }) => { /* ... */ })
alepha.on("job:end", ({ name, executionId }) => { /* ... */ })
```

### 7.3 Graceful Shutdown

On `SIGTERM` / `SIGINT` (deploy, scale-down, process restart), the `JobProvider` performs a graceful shutdown:

1. **Stop claiming.** Immediately stop polling the queue for new jobs. No new executions are started.
2. **Wait for running handlers.** Allow in-flight handlers to complete, up to a configurable grace period (`shutdownGracePeriod`, default: 30 seconds). The handler's `signal` is **not** triggered during this phase — handlers are given a chance to finish normally.
3. **Abort remaining.** If the grace period expires and handlers are still running, trigger the `AbortSignal` on remaining executions. Handlers should check `signal.aborted` and exit promptly.
4. **Leave status as `running`.** Do **not** update the DB status of aborted executions. The recovery sweep (section 5.1) will detect them as crashed and apply the retry policy. This avoids a race between the shutdown write and the handler's final write.

This ensures that every deploy does not create orphaned `running` rows that wait 30 minutes for recovery — in the normal case, handlers finish within the grace period and update their own status.

---

## 8. Module Registration

```ts
import { $module } from "alepha"

export const AlephaApiJobs = $module({
  name: "alepha.api.jobs",
  imports: [AlephaQueue, AlephaScheduler, AlephaBatch],
  services: [JobProvider, JobService, AdminJobController],
  primitives: [$job],
})
```

---

## 9. Configuration

### 9.1 Config Atom

Configuration uses a `$atom` — a named, schema-validated config object with defaults. The `JobProvider` reads from this atom at runtime, and users can override values per environment.

```ts
import { $atom, t } from "alepha"

export const jobConfig = $atom({
  name: "alepha.jobs",
  description: "Configuration for the $job v2 primitive.",
  schema: t.object({
    batchWindow: t.integer({ description: "Max time (ms) to buffer pushes before flushing." }),
    batchMaxSize: t.integer({ description: "Max items per flush." }),
    recovery: t.object({
      interval: t.integer({ description: "Sweep interval (ms)." }),
      staleThreshold: t.integer({ description: "Pending age (ms) before re-dispatch." }),
      runTimeout: t.integer({ description: "Running age (ms) before assumed crash. Used as fallback when no per-job timeout is set." }),
    }),
    delayed: t.object({
      interval: t.integer({ description: "Sweep interval (ms)." }),
    }),
    logRetentionDays: t.integer({ description: "Days to keep completed/dead executions." }),
    logMaxEntries: t.integer({ description: "Max log entries captured per execution." }),
    shutdownGracePeriod: t.integer({ description: "Max time (ms) to wait for running handlers on shutdown." }),
    prefix: t.optional(t.text({ description: "Prefix for lock keys (multi-tenant)." })),
  }),
  default: {
    batchWindow: 10,
    batchMaxSize: 1000,
    recovery: {
      interval: 60_000,
      staleThreshold: 300_000,
      runTimeout: 1_800_000,
    },
    delayed: {
      interval: 30_000,
    },
    logRetentionDays: 30,
    logMaxEntries: 100,
    shutdownGracePeriod: 30_000,
  },
})
```

The `JobProvider` reads it via `$use`:

```ts
class JobProvider {
  protected readonly config = $use(jobConfig)

  protected onStart() {
    const { recovery } = this.config
    // recovery.interval is 60_000 by default, or whatever the user overrode
  }
}
```

### 9.2 Overriding Per Environment

Users override the atom in their `alepha.config.ts`:

```ts
// alepha.config.ts (development)
import { jobConfig } from "alepha/api/jobs"

export default defineConfig({
  atoms: {
    [jobConfig.key]: {
      batchWindow: 0,                            // flush immediately in dev
      recovery: { interval: 5_000 },             // aggressive sweep in dev
      delayed: { interval: 5_000 },
    },
  },
})
```

```ts
// alepha.config.ts (production)
import { jobConfig } from "alepha/api/jobs"

export default defineConfig({
  atoms: {
    [jobConfig.key]: {
      logRetentionDays: 90,
    },
  },
})
```

---

## 10. Observability

### 10.1 Structured Logging

Every execution emits structured log entries through Alepha's logger:

```
[job] UserJobs.purgeUser | exec=abc123 | attempt=1/4 | status=running
[job] UserJobs.purgeUser | exec=abc123 | attempt=1/4 | status=completed | duration=342ms
```

Handler logs are captured via the `"log"` event. Each execution runs within a unique context ID (`alepha.context.createContextId()`). All `LogEntry` objects emitted during execution with a matching `context` are collected in memory and written to the `job_execution_logs` table (section 6.2) on completion or failure.

Each `LogEntry` contains: `level` (TRACE/DEBUG/INFO/WARN/ERROR), `message`, `service`, `module`, `context`, `app`, `data`, `timestamp`.

The array is capped at `logMaxEntries` (default: 100). When the cap is reached, oldest entries are dropped and a final entry is appended with `level: "WARN"` and `message: "Log entries truncated at {logMaxEntries}"`. Set `logMaxEntries: 0` to disable per-execution log capture entirely.

**Storage strategy.** Logs are stored in a separate `job_execution_logs` table (section 6.2), not inline in `job_executions`. This keeps the hot execution table lean (~200 bytes/row) for fast sweeps, claims, and dashboard queries. Logs are only fetched when viewing a specific execution detail — a single read by ID on the cold table.

### 10.2 Admin Controller

All endpoints require authentication (`secure: true`) and are grouped under `admin:jobs`.

#### 10.2.1 Schemas

```ts
import { t } from "alepha"
import { pageQuerySchema } from "alepha/orm"
import { logEntrySchema } from "alepha/logger"
import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts"

// --- Query schema for execution list ---
export const jobExecutionQuerySchema = t.extend(pageQuerySchema, {
  job: t.optional(t.text({ description: "Filter by job name" })),
  status: t.optional(
    t.enum(["pending", "scheduled", "running", "completed", "failed", "dead", "cancelled"]),
  ),
  priority: t.optional(t.enum(["critical", "high", "normal", "low"])),
  from: t.optional(t.datetime({ description: "Filter executions created after this datetime" })),
  to: t.optional(t.datetime({ description: "Filter executions created before this datetime" })),
})

// --- Resource schema for execution list (no logs — those are fetched separately) ---
export const jobExecutionResourceSchema = t.extend(
  jobExecutionEntity.schema,
  {},
  { title: "JobExecutionResource" },
)

// --- Resource schema for execution detail (includes logs) ---
export const jobExecutionDetailResourceSchema = t.extend(
  jobExecutionEntity.schema,
  {
    logs: t.optional(t.array(logEntrySchema)),
  },
  { title: "JobExecutionDetailResource" },
)

// --- Trigger request body ---
export const triggerJobSchema = t.object({
  name: t.text({ description: "Fully qualified job name, e.g. UserJobs.purgeUser" }),
  payload: t.optional(t.record(t.text(), t.any())),
})

// --- Job registration info (read-only, from registry) ---
export const jobRegistrationSchema = t.object({
  name: t.text(),
  type: t.enum(["push", "cron", "both"]),
  cron: t.optional(t.text()),
  lock: t.boolean(),
  priority: t.enum(["critical", "high", "normal", "low"]),
  concurrency: t.integer(),
  timeout: t.optional(t.text()),
  batch: t.optional(t.object({
    size: t.integer(),
    window: t.text(),
  })),
  retry: t.object({
    retries: t.integer(),
    backoff: t.text(),
  }),
  schema: t.optional(t.record(t.text(), t.any())),
})

// --- Dashboard stats ---
export const jobStatsSchema = t.object({
  registered: t.integer(),
  running: t.integer(),
  pending: t.integer(),
  scheduled: t.integer(),
  dead: t.integer(),
  completed24h: t.integer(),
  failed24h: t.integer(),
})
```

#### 10.2.2 Controller

```ts
import { $inject, t } from "alepha"
import { $action, okSchema } from "alepha/server"
import { JobService } from "../services/JobService.ts"

export class AdminJobController {
  protected readonly url = "/jobs"
  protected readonly group = "admin:jobs"
  protected readonly jobService = $inject(JobService)

  /**
   * Get dashboard stats (registered count, running, pending, dead, 24h throughput).
   */
  public readonly getStats = $action({
    path: `${this.url}/stats`,
    group: this.group,
    secure: true,
    description: "Get job dashboard statistics",
    schema: {
      response: jobStatsSchema,
    },
    handler: () => this.jobService.getStats(),
  })

  /**
   * List all registered job definitions with their configuration.
   */
  public readonly getRegistry = $action({
    path: this.url,
    group: this.group,
    secure: true,
    description: "List all registered job definitions",
    schema: {
      response: t.array(jobRegistrationSchema),
    },
    handler: () => this.jobService.getRegistry(),
  })

  /**
   * Query execution history with filtering and pagination.
   */
  public readonly findExecutions = $action({
    path: `${this.url}/executions`,
    group: this.group,
    secure: true,
    description: "Query job execution history",
    schema: {
      query: jobExecutionQuerySchema,
      response: t.page(jobExecutionResourceSchema),
    },
    handler: ({ query }) => this.jobService.findExecutions(query),
  })

  /**
   * Get a single execution by ID, including captured logs.
   */
  public readonly getExecution = $action({
    path: `${this.url}/executions/:id`,
    group: this.group,
    secure: true,
    description: "Get execution details with logs",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: jobExecutionDetailResourceSchema,
    },
    handler: ({ params }) => this.jobService.getExecution(params.id),
  })

  /**
   * Manually trigger a job. For push-based jobs, payload is validated
   * against the job's schema. For cron-only jobs, payload must be omitted.
   */
  public readonly triggerJob = $action({
    method: "POST",
    path: `${this.url}/trigger`,
    group: this.group,
    secure: true,
    description: "Manually trigger a job",
    schema: {
      body: triggerJobSchema,
      response: okSchema,
    },
    handler: ({ body, user }) =>
      this.jobService.triggerJob(body.name, {
        payload: body.payload,
        triggeredBy: user.id,
        triggeredByName: user.name,
      }),
  })

  /**
   * Retry a dead execution. Creates a new execution with the same
   * payload, resetting attempt count. The original stays as dead.
   */
  public readonly retryExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/retry`,
    group: this.group,
    secure: true,
    description: "Retry a dead execution",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: ({ params, user }) =>
      this.jobService.retryExecution(params.id, {
        triggeredBy: user.id,
        triggeredByName: user.name,
      }),
  })

  /**
   * Cancel a pending, scheduled, or running execution.
   * Running executions receive an AbortSignal.
   */
  public readonly cancelExecution = $action({
    method: "POST",
    path: `${this.url}/executions/:id/cancel`,
    group: this.group,
    secure: true,
    description: "Cancel a pending or running execution",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: ({ params, user }) =>
      this.jobService.cancelExecution(params.id, {
        cancelledBy: user.id,
        cancelledByName: user.name,
      }),
  })
}
```

#### 10.2.3 Service

```ts
import { $inject, $logger } from "alepha"
import { $repository } from "alepha/orm"
import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts"
import { jobExecutionLogEntity } from "../entities/jobExecutionLogEntity.ts"
import { JobProvider } from "../providers/JobProvider.ts"

export class JobService {
  protected readonly log = $logger()
  protected readonly provider = $inject(JobProvider)
  protected readonly executions = $repository(jobExecutionEntity)
  protected readonly executionLogs = $repository(jobExecutionLogEntity)

  /**
   * Dashboard stats: counts by status + 24h throughput.
   */
  public async getStats() { /* ... */ }

  /**
   * All registered job definitions from the in-memory registry.
   */
  public getRegistry() { /* ... */ }

  /**
   * Paginated execution query. Joins nothing — logs are fetched separately.
   */
  public async findExecutions(query: JobExecutionQuery) { /* ... */ }

  /**
   * Single execution with logs. Two queries: one to job_executions,
   * one to job_execution_logs by same ID.
   */
  public async getExecution(id: string) { /* ... */ }

  /**
   * Trigger a job by name. Validates payload against schema if present.
   */
  public async triggerJob(name: string, context: TriggerContext) { /* ... */ }

  /**
   * Retry a dead execution. Creates a new push with the same payload.
   * The original execution stays as dead for audit trail.
   */
  public async retryExecution(id: string, context: TriggerContext) { /* ... */ }

  /**
   * Cancel a pending/scheduled/running execution.
   * Delegates to JobProvider.cancel() which handles the AbortSignal.
   */
  public async cancelExecution(id: string, context: CancelContext) { /* ... */ }
}
```

---

## 11. Complete Example

```ts
import { $job } from "alepha/api/jobs"
import { $inject, $logger, t } from "alepha"

class NotificationJobs {
  protected readonly mailer = $inject(Mailer)
  protected readonly pushService = $inject(PushService)
  protected readonly log = $logger()

  /**
   * Send email notifications in batches.
   */
  sendEmail = $job({
    schema: t.object({
      to: t.email(),
      subject: t.text(),
      body: t.text(),
      templateId: t.optional(t.text()),
    }),

    priority: "high",
    concurrency: 3,
    timeout: [2, "minute"],

    batch: {
      size: 50,
      window: [2, "second"],
    },

    retry: {
      retries: 5,
      backoff: { initial: [5, "second"], factor: 2, max: [5, "minute"] },
      when: (error) => !(error instanceof ValidationError),
    },

    handler: async ({ items, signal }) => {
      const emails = items.map((item) => ({
        to: item.payload.to,
        subject: item.payload.subject,
        body: item.payload.body,
      }))
      await this.mailer.sendBulk(emails, { signal })
      this.log.info(`Sent ${emails.length} emails`)
    },
  })

  /**
   * Daily digest — cron-triggered, no payload needed.
   */
  dailyDigest = $job({
    cron: "0 9 * * *",
    lock: true,
    retry: { retries: 2, backoff: [1, "minute"] },

    handler: async ({ now }) => {
      const users = await this.getDigestSubscribers()
      const pushItems = await Promise.all(
        users.map(async (user) => ({
          to: user.email,
          subject: `Your daily digest for ${now.toFormat("MMM d")}`,
          body: await this.buildDigestHtml(user, now),
        })),
      )
      await this.sendEmail.push(pushItems)
      this.log.info(`Queued ${users.length} digest emails`)
    },
  })

  protected async getDigestSubscribers() { /* ... */ }
  protected async buildDigestHtml(user: User, now: DateTime) { /* ... */ }
}
```

---

## 12. Admin UI

The jobs admin UI lives under `/admin/jobs` and provides 5 views: **Dashboard**, **Registry**, **Executions**, **Cron**, and **Queue**. It follows the existing devtools visual language (`@alepha/ui`, `midnightTheme`, `ui.colors.*` tokens, `@tabler/icons-react`).

### 12.1 Dashboard

Overview with real-time stats. Polls every 10s.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Jobs                                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  12          │  │  3           │  │  847         │  │  2           │    │
│  │  Registered  │  │  Running     │  │  Completed   │  │  Dead        │    │
│  │  ● ● ● ●    │  │  ◕ ◕ ◕      │  │  24h         │  │  ▲ Needs     │    │
│  │              │  │              │  │              │  │    attention  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                             │
│  Throughput (24h)                             Failure rate (24h)            │
│  ┌──────────────────────────────────┐        ┌────────────────────────┐    │
│  │  ▁▂▃▅▇▇▅▃▂▁▁▂▃▅▇█▇▅▃▂▁▁▂▃▅▇▅ │        │  ▁▁▁▂▅▂▁▁▁▁▁▁▁▁▃▁▁▁ │    │
│  │  00:00      06:00      12:00    │        │  0.2%    avg           │    │
│  └──────────────────────────────────┘        └────────────────────────┘    │
│                                                                             │
│  Recent Activity                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  TIME       JOB                        STATUS     DURATION         │    │
│  │  ─────────────────────────────────────────────────────────────────  │    │
│  │  14:32:01   NotificationJobs.sendEmail  ● completed  342ms         │    │
│  │  14:31:58   ReportJobs.dailyReport      ● completed  1.2s         │    │
│  │  14:31:45   UserJobs.purgeUser          ● completed  89ms          │    │
│  │  14:31:30   NotificationJobs.sendEmail  ● completed  291ms         │    │
│  │  14:30:12   AnalyticsJobs.aggregate     ● failed     12.4s         │    │
│  │  14:29:55   NotificationJobs.sendEmail  ● running    ...           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  Top Failures (7d)                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  JOB                             FAILURES   LAST ERROR              │    │
│  │  ─────────────────────────────────────────────────────────────────  │    │
│  │  AnalyticsJobs.aggregate         14         Connection timeout      │    │
│  │  NotificationJobs.sendEmail      3          SMTP 421 rate limit    │    │
│  │  UserJobs.purgeUser              1          FK constraint violated  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.2 Registry

All registered `$job` definitions with their configuration. Read-only.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Jobs > Registry                                                    12 jobs │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌ Search ─────────────────────────┐  Filter: [All] [Cron] [Push] [Both]   │
│  │  🔍 Search jobs...              │                                        │
│  └─────────────────────────────────┘                                        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  NAME                          TYPE   PRIORITY  RETRY  CONCURRENCY │    │
│  │  ─────────────────────────────────────────────────────────────────  │    │
│  │  NotificationJobs.sendEmail    push   high      5/exp  3           │    │
│  │    schema: { to, subject, body, templateId? }                      │    │
│  │    batch: 50 items / 2s window | timeout: 2m                       │    │
│  │                                                                    │    │
│  │  NotificationJobs.dailyDigest  cron   normal    2/fix  1           │    │
│  │    schedule: 0 9 * * * (every day at 09:00)                        │    │
│  │    lock: true | next run: Feb 10, 2026 09:00                       │    │
│  │                                                                    │    │
│  │  UserJobs.purgeUser            push   normal    3/exp  5           │    │
│  │    schema: { userId, reason? }                                     │    │
│  │    batch: 100 items / 1s window | timeout: 10m                     │    │
│  │                                                                    │    │
│  │  ReportJobs.dailyReport        cron   normal    2/fix  1           │    │
│  │    schedule: 0 8 * * 1-5 (weekdays at 08:00)                      │    │
│  │    lock: true | next run: Feb 10, 2026 08:00                       │    │
│  │                                                                    │    │
│  │  AnalyticsJobs.aggregate       both   low       3/exp  2           │    │
│  │    schedule: */15 * * * * (every 15 minutes)                       │    │
│  │    schema: { dateRange?, force? }                                  │    │
│  │    timeout: 5m | next run: Feb 9, 2026 14:45                       │    │
│  │                                                                    │    │
│  │  PaymentJobs.processWebhook    push   critical  5/exp  10          │    │
│  │    schema: { eventId, provider, payload }                          │    │
│  │    timeout: 30s                                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.3 Executions

Searchable, filterable execution history. Click a row to open detail view.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Jobs > Executions                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌ Search ─────────────────────────┐  Job: [All jobs        ▾]             │
│  │  🔍 Search by ID, key...        │  Status: [All] [Running] [Failed]     │
│  └─────────────────────────────────┘         [Dead] [Cancelled]            │
│                                       Period: [Last 1h ▾]                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  STATUS  JOB                        ATTEMPT  STARTED     DURATION  │    │
│  │  ─────────────────────────────────────────────────────────────────  │    │
│  │  ● run   NotificationJobs.sendEmail  1/6     14:32:01    ...       │    │
│  │  ● done  NotificationJobs.sendEmail  1/6     14:31:30    342ms     │    │
│  │  ● done  ReportJobs.dailyReport      1/3     14:31:58    1.2s      │    │
│  │  ● done  UserJobs.purgeUser          1/4     14:31:45    89ms      │    │
│  │  ● fail  AnalyticsJobs.aggregate     4/4     14:30:12    12.4s     │    │
│  │          ↳ Error: Connection timeout to analytics.example.com      │    │
│  │  ● dead  AnalyticsJobs.aggregate     4/4     14:15:02    11.8s     │    │
│  │          ↳ Error: Connection timeout (exhausted 3 retries)         │    │
│  │  ○ schd  UserJobs.purgeUser          —       —           —         │    │
│  │          ↳ Scheduled for Feb 9, 14:45 | key: purge_user_456       │    │
│  │  ✕ cncl  UserJobs.purgeUser          1/4     14:10:00    2.1s      │    │
│  │          ↳ Cancelled by John Doe                                   │    │
│  │                                                                    │    │
│  │  ‹ 1  2  3  4  5 ... 24 ›                     Showing 1-20 of 472 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.4 Execution Detail

Full execution detail with payload, logs, and actions.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Jobs > Executions > exec-a1b2c3d4                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  NotificationJobs.sendEmail                                                 │
│  ● failed  ·  Attempt 2 of 6  ·  Retry scheduled in 10s                   │
│                                                                             │
│  ┌ Actions ─────────────────────────────────────────────────────────────┐   │
│  │  [ Retry Now ]    [ Cancel ]                                         │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌ Details ─────────────────────────────────────────────────────────────┐   │
│  │  ID            a1b2c3d4-e5f6-7890-abcd-ef1234567890                 │   │
│  │  Status        failed (retry scheduled → Feb 9, 14:32:15)           │   │
│  │  Priority      high (1)                                              │   │
│  │  Attempt       2 / 6                                                 │   │
│  │  Worker        worker-node-02:8421:a3f2                              │   │
│  │  Key           send_welcome_user-789                                 │   │
│  │  Created       Feb 9, 2026 14:30:00.000                             │   │
│  │  Started       Feb 9, 2026 14:31:58.123                             │   │
│  │  Duration      4.2s                                                  │   │
│  │  Triggered by  system (cron)                                         │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌ Payload ─────────────────────────────────────────────────────────────┐   │
│  │  {                                                                   │   │
│  │    "to": "jane@example.com",                                         │   │
│  │    "subject": "Welcome to Acme",                                     │   │
│  │    "body": "<h1>Welcome!</h1><p>Thanks for joining...</p>",         │   │
│  │    "templateId": "welcome-v2"                                        │   │
│  │  }                                                                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌ Error ───────────────────────────────────────────────────────────────┐   │
│  │  SmtpError: 421 Too many connections from your IP                    │   │
│  │    at SmtpTransport.send (smtp.ts:142)                               │   │
│  │    at Mailer.sendBulk (mailer.ts:67)                                 │   │
│  │    at NotificationJobs.handler (NotificationJobs.ts:38)              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌ Logs (23 entries) ───────────────────────────────────────────────────┐   │
│  │  LEVEL  TIME         SERVICE              MESSAGE                    │   │
│  │  ─────────────────────────────────────────────────────────────────── │   │
│  │  INFO   14:31:58.1   NotificationJobs     Processing batch of 50    │   │
│  │  DEBUG  14:31:58.2   Mailer               Connecting to smtp.acme   │   │
│  │  DEBUG  14:31:58.5   Mailer               Connected, sending bulk   │   │
│  │  INFO   14:31:59.0   Mailer               Sent 12/50 emails         │   │
│  │  INFO   14:31:59.8   Mailer               Sent 24/50 emails         │   │
│  │  WARN   14:32:00.1   Mailer               SMTP slowdown detected    │   │
│  │  INFO   14:32:00.9   Mailer               Sent 36/50 emails         │   │
│  │  ERROR  14:32:02.3   Mailer               SMTP 421 rate limit       │   │
│  │  ─────────────────────────────────────────────────────────────────── │   │
│  │  ▾ Show data for selected log entry                                  │   │
│  │  {                                                                   │   │
│  │    "host": "smtp.acme.com",                                          │   │
│  │    "responseCode": 421,                                              │   │
│  │    "sent": 36,                                                       │   │
│  │    "total": 50                                                       │   │
│  │  }                                                                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.5 Cron

Dedicated view for all cron-scheduled jobs. Shows schedule, lock status, and next/last run.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Jobs > Cron                                                       5 crons │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  JOB                          SCHEDULE          LOCK  NEXT RUN     │    │
│  │  ─────────────────────────────────────────────────────────────────  │    │
│  │                                                                    │    │
│  │  ● ReportJobs.dailyReport     0 8 * * 1-5       yes   Feb 10 08:00│    │
│  │    Weekdays at 08:00                                               │    │
│  │    Last: Feb 9 08:00 → completed (1.2s)                            │    │
│  │    [ Trigger Now ]                                                 │    │
│  │                                                                    │    │
│  │  ● NotificationJobs.digest    0 9 * * *         yes   Feb 10 09:00│    │
│  │    Every day at 09:00                                              │    │
│  │    Last: Feb 9 09:00 → completed (3.4s)                            │    │
│  │    [ Trigger Now ]                                                 │    │
│  │                                                                    │    │
│  │  ● AnalyticsJobs.aggregate    */15 * * * *      yes   Feb 9 14:45 │    │
│  │    Every 15 minutes                                                │    │
│  │    Last: Feb 9 14:30 → failed (12.4s) — Connection timeout         │    │
│  │    [ Trigger Now ]                                                 │    │
│  │                                                                    │    │
│  │  ● SystemJobs.recovery        _system (1m)      yes   Feb 9 14:33 │    │
│  │    Internal: recovery sweep                                        │    │
│  │    Last: Feb 9 14:32 → completed (45ms)                            │    │
│  │                                                                    │    │
│  │  ● SystemJobs.delayed         _system (30s)     yes   Feb 9 14:32 │    │
│  │    Internal: delayed dispatch sweep                                │    │
│  │    Last: Feb 9 14:32 → completed (12ms)                            │    │
│  │                                                                    │    │
│  │  ○ SystemJobs.purge           0 3 * * *         yes   Feb 10 03:00│    │
│  │    Internal: log purge                                             │    │
│  │    Last: Feb 9 03:00 → completed (890ms) — Purged 1,247 records    │    │
│  │                                                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  Timeline (next 24h)                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  14:45  AnalyticsJobs.aggregate                                    │    │
│  │  15:00  AnalyticsJobs.aggregate                                    │    │
│  │  15:15  AnalyticsJobs.aggregate                                    │    │
│  │   ...   (every 15m)                                                │    │
│  │  03:00  SystemJobs.purge                                           │    │
│  │  08:00  ReportJobs.dailyReport                                     │    │
│  │  09:00  NotificationJobs.digest                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.6 Queue

Real-time queue depth, worker status, and throughput. Polls every 5s.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Jobs > Queue                                                   3 workers  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  47           │  │  3           │  │  12.4/s      │  │  0           │    │
│  │  Pending      │  │  Running     │  │  Throughput   │  │  Scheduled   │    │
│  │  in queue     │  │  right now   │  │  last 5m avg  │  │  delayed     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                             │
│  Queue Depth by Job                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  JOB                          PENDING  RUNNING  SCHEDULED  DEAD    │    │
│  │  ─────────────────────────────────────────────────────────────────  │    │
│  │  NotificationJobs.sendEmail   38       2/3      0          0       │    │
│  │  ████████████████████░░░                                           │    │
│  │                                                                    │    │
│  │  UserJobs.purgeUser           7        1/5      0          0       │    │
│  │  ████░░░░░░░░░░░░░░░░░                                            │    │
│  │                                                                    │    │
│  │  AnalyticsJobs.aggregate      0        0/2      0          2       │    │
│  │  ░░░░░░░░░░░░░░░░░░░░░   ▲ 2 dead executions                     │    │
│  │                                                                    │    │
│  │  PaymentJobs.processWebhook   2        0/10     0          0       │    │
│  │  █░░░░░░░░░░░░░░░░░░░░                                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  Workers                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  WORKER            STATUS     CURRENT JOB                  UPTIME  │    │
│  │  ─────────────────────────────────────────────────────────────────  │    │
│  │  worker-node-01    ● busy     NotificationJobs.sendEmail   4h 12m  │    │
│  │  worker-node-02    ● busy     NotificationJobs.sendEmail   4h 12m  │    │
│  │  worker-node-03    ● busy     UserJobs.purgeUser           4h 12m  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  Throughput (1h)                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                          ▇                                         │    │
│  │                    ▅     █                                         │    │
│  │              ▃     █     █     ▅                                   │    │
│  │  ▂     ▂     █     █     █     █     ▃                            │    │
│  │  █     █     █     █     █     █     █     ▂                      │    │
│  │  █  ▁  █  ▁  █  ▁  █  ▁  █  ▁  █  ▁  █  ▁  █                    │    │
│  │  13:30  13:40  13:50  14:00  14:10  14:20  14:30                  │    │
│  │  ■ completed  ■ failed                                             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.7 Navigation

The jobs UI is accessible from the main admin sidebar:

```
┌──────────────┬──────────────────────────────────────────────────────────────┐
│  Admin       │                                                              │
│              │                                                              │
│  Dashboard   │                                                              │
│  Users       │                                                              │
│  Sessions    │                                                              │
│  API Keys    │                                                              │
│  Parameters  │                                                              │
│  Audits      │                                                              │
│  ─────────── │                                                              │
│  Jobs    ◂── │   ← new section                                              │
│   Dashboard  │                                                              │
│   Registry   │                                                              │
│   Executions │                                                              │
│   Cron       │                                                              │
│   Queue      │                                                              │
│  ─────────── │                                                              │
│  Verif.      │                                                              │
│              │                                                              │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

---

## 13. Decisions

1. **Handler signature.** The handler always receives `{ items, now, signal }`. `items` is always an array: `[]` for cron-only, `[item]` for single push, `[...items]` for batched. Uniform, no conditional logic needed.

2. **Dead Letter Queue.** `dead` status on the main entity is sufficient. A separate DLQ entity adds complexity for no gain. The log purge sweep can use different retention for dead vs completed if needed.

3. **Job dependencies / chaining.** Out of scope — that's `$workflow` territory. Users can chain jobs in their handlers.

4. **Rate limiting.** Handler-level concern, not a job primitive responsibility. Implement in the handler with a shared rate limiter service.

5. **Schema migration.** Changing a job's payload schema is a breaking change for pending executions. The payload is validated at push time only — not at claim time. This means pending jobs with old payloads will execute without validation errors, but the handler receives data matching the old schema. For breaking changes (removing a required field, changing types), drain the queue before deploying. For additive changes (new optional fields), no action is needed.

6. **Push API design.** `.push(payload, options?)` for single or batch pushes (shared options). `.pushMany([{ payload, ...options }])` for batch pushes with per-item options. This avoids the ambiguity of detecting whether an object is a payload or a `{ payload, ...options }` wrapper — the two methods have distinct signatures, no magic detection needed.

7. **Retry naming.** `retry.retries` (not `retry.max`) — the number of retries after the first failure. `retries: 0` means no retry (1 total attempt), `retries: 3` means up to 4 total attempts. This matches developer intuition: "retry 3 times" means 3 retries, not 3 total attempts.

8. **Attempt counting.** `attempt` is incremented at claim time (before execution), not on failure. During the first execution, `attempt = 1`. This makes the value immediately meaningful in logs and UI: "attempt 1 of 4" means first try. The job is dead when `attempt >= maxAttempts` after a failure.
