import { type Infer, z } from "alepha";
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
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    jobName: z.text(),
    key: z.text().nullable().optional(),

    /**
     * Owning tenant for this execution, when it was pushed in (or for) a tenant
     * context. Used to org-scope tenant-facing views — notably the notification
     * admin list, which is backed by this outbox. Nullable: cron / global / non-
     * tenant pushes carry none. Deliberately NOT `db.organization()`: the job
     * worker + sweep must see every org's rows, so this stays a plain,
     * non-auto-scoping column rather than an auto-filtered one.
     */
    organizationId: z.uuid().nullable().optional(),

    status: db.default(
      z.enum(["pending", "running", "scheduled", "ok", "error", "cancelled"]),
      "pending",
    ),
    priority: db.default(z.integer().min(0).max(3), 2),

    attempt: db.default(z.integer(), 0),
    maxAttempts: db.default(z.integer(), 1),

    payload: z.record(z.text(), z.any()).optional(),

    scheduledAt: z.datetime().optional(),
    startedAt: z.datetime().optional(),
    completedAt: z.datetime().optional(),

    error: z.text().optional(),
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
