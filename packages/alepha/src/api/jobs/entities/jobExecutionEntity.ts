import { type Static, t } from "alepha";
import { logEntrySchema } from "alepha/logger";
import { $entity, db } from "alepha/orm";

/**
 * Job execution record.
 *
 * Stores durable state for queue-mode jobs (outbox pattern) and error records
 * for cron-mode jobs. Successful executions are trimmed by the sweep to keep
 * the last N rows per job (configurable via `jobConfig.keepLastSuccess`).
 *
 * Status transitions:
 * - queue push            → pending (or `scheduled` if `delay`/`scheduledAt` was given)
 * - worker claim          → running
 * - success               → ok (or row deleted, depending on `record` and `keepLastSuccess`)
 * - terminal failure      → error
 * - retryable failure     → scheduled (with scheduledAt = now; sweep picks it up)
 * - delay                 → scheduled (with scheduledAt = now + delay)
 * - sweep picks due ones  → pending
 * - cancel                → cancelled
 */
export const jobExecutionEntity = $entity({
  name: "job_executions",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    jobName: t.text(),
    key: t.optional(t.nullable(t.text())),

    status: db.default(
      t.enum(["pending", "running", "scheduled", "ok", "error", "cancelled"]),
      "pending",
    ),
    priority: db.default(t.integer({ minimum: 0, maximum: 3 }), 2),

    attempt: db.default(t.integer(), 0),
    maxAttempts: db.default(t.integer(), 1),

    payload: t.optional(t.record(t.text(), t.any())),

    scheduledAt: t.optional(t.datetime()),
    startedAt: t.optional(t.datetime()),
    completedAt: t.optional(t.datetime()),

    error: t.optional(t.text()),
    logs: t.optional(t.array(logEntrySchema)),

    triggeredBy: t.optional(t.text()),
    triggeredByName: t.optional(t.text()),
    cancelledBy: t.optional(t.text()),
    cancelledByName: t.optional(t.text()),
  }),
  indexes: [
    { columns: ["jobName", "status", "scheduledAt"] },
    { columns: ["jobName", "startedAt"] },
    { columns: ["jobName", "key"], unique: true },
  ],
});

export type JobExecutionEntity = Static<typeof jobExecutionEntity.schema>;

export type JobStatus =
  | "pending"
  | "running"
  | "scheduled"
  | "ok"
  | "error"
  | "cancelled";
