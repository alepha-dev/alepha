import { type Infer, z } from "alepha";
import { logEntrySchema } from "alepha/logger";
import { $entity, db } from "alepha/orm";

/**
 * Job execution record.
 *
 * Stores durable state for queue-mode jobs (outbox pattern) and the terminal
 * record of every run a job keeps. How many rows of each status a job keeps,
 * and for how long, is its `retention`; the hourly trim enforces it, and
 * deletes the rows of any job name nothing registers.
 *
 * Status transitions:
 * - queue push            → pending (or `scheduled` if `delay`/`scheduledAt` was given)
 * - worker claim          → running
 * - success               → ok (or row deleted, when the job does not record successes)
 * - terminal failure      → error (or row deleted, when the job does not record failures)
 * - retryable failure     → scheduled (with scheduledAt = now; sweep picks it up)
 * - delay                 → scheduled (with scheduledAt = now + delay)
 * - handler reschedule()  → scheduled (next scheduledAt and payload, attempt reset, same id and key)
 * - sweep picks due ones  → pending
 * - cancel                → cancelled
 */
export const jobExecutionEntity = $entity({
  name: "job_executions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    jobName: z.text(),
    key: z.text().nullable().optional(),

    status: db.default(
      z.enum(["pending", "running", "scheduled", "ok", "error", "cancelled"]),
      "pending",
    ),
    attempt: db.default(z.integer(), 0),
    maxAttempts: db.default(z.integer(), 1),

    /**
     * How many times the sweep has re-dispatched this row while it was still
     * `pending`, i.e. how many deliveries were lost between dispatch and
     * `claim()`.
     *
     * Separate from `attempt`, which only moves inside `claim()` and counts
     * attempts that actually *ran*. They cannot share a column: a queue that
     * is merely slower than `staleThreshold` produces re-dispatches without
     * producing failures, and spending the retry budget on those would kill
     * jobs that were going to succeed.
     *
     * Bounded by `jobConfig.maxRedispatch`; past it the row goes terminal.
     */
    redispatchCount: db.default(z.integer(), 0),

    payload: z.record(z.text(), z.any()).optional(),

    scheduledAt: z.datetime().optional(),
    startedAt: z.datetime().optional(),
    completedAt: z.datetime().optional(),

    error: z.text().optional(),

    /**
     * The log entries captured while the run executed, stored when it ends,
     * whatever its outcome: up to `jobConfig.logMaxEntries`, and TRACE and
     * DEBUG entries included even when `LOG_LEVEL` hides them. Nothing is
     * written while a run is in progress.
     */
    logs: z.array(logEntrySchema).optional(),

    triggeredBy: z.text().optional(),
    triggeredByName: z.text().optional(),
    cancelledBy: z.text().optional(),
    cancelledByName: z.text().optional(),
  }),
  indexes: [
    { columns: ["jobName", "status", "scheduledAt"] },
    { columns: ["jobName", "status", "createdAt"] },
    { columns: ["jobName", "startedAt"] },
    { columns: ["jobName", "key"], unique: true },
  ],
});

export type JobExecutionEntity = Infer<typeof jobExecutionEntity.schema>;

export type JobStatus =
  | "pending"
  | "running"
  | "scheduled"
  | "ok"
  | "error"
  | "cancelled";
