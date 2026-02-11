import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const jobExecutionEntity = $entity({
  name: "job_executions",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    jobName: t.text(),
    key: t.optional(t.nullable(t.text())),

    payload: t.optional(t.record(t.text(), t.any())),
    status: db.default(
      t.enum([
        "pending",
        "scheduled",
        "retrying",
        "running",
        "completed",
        "failed",
        "dead",
        "cancelled",
      ]),
      "pending",
    ),
    priority: db.default(t.integer({ minimum: 0, maximum: 3 }), 2),

    attempt: db.default(t.integer(), 0),
    maxAttempts: db.default(t.integer(), 1),

    scheduledAt: t.optional(t.datetime()),
    startedAt: t.optional(t.datetime()),
    completedAt: t.optional(t.datetime()),

    result: t.optional(t.record(t.text(), t.any())),
    error: t.optional(t.text()),
    workerId: t.optional(t.text()),

    triggeredBy: t.optional(t.text()),
    triggeredByName: t.optional(t.text()),
    cancelledBy: t.optional(t.text()),
    cancelledByName: t.optional(t.text()),
  }),
  indexes: [
    { columns: ["jobName", "status", "priority", "scheduledAt"] },
    { columns: ["jobName", "status", "startedAt"] },
    { columns: ["jobName", "completedAt"] },
    { columns: ["jobName", "key"], unique: true },
  ],
});

export type JobExecutionEntity = Static<typeof jobExecutionEntity.schema>;

export type JobStatus =
  | "pending"
  | "scheduled"
  | "retrying"
  | "running"
  | "completed"
  | "failed"
  | "dead"
  | "cancelled";
