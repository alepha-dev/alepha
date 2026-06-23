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

    /**
     * Owning tenant for this execution, when it was pushed in (or for) a tenant
     * context. Used to org-scope tenant-facing views — notably the notification
     * admin list, which is backed by this outbox. Nullable: cron / global / non-
     * tenant pushes carry none. Deliberately NOT `db.organization()`: the job
     * worker + sweep must see every org's rows, so this stays a plain,
     * non-auto-scoping column rather than an auto-filtered one.
     */
    organizationId: t.optional(t.nullable(t.uuid())),

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
    { columns: ["jobName", "status", "createdAt"] },
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
