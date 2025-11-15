import { type Static, t } from "@alepha/core";
import { logEntrySchema } from "@alepha/logger";
import { $entity, pg } from "@alepha/orm";

export const jobExecutions = $entity({
  name: "job_executions",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    version: pg.version(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    finishedAt: t.optional(t.datetime()),
    job: t.string(),
    status: t.enum(["STARTED", "FAILED", "COMPLETED"]),
    error: t.optional(t.string()),
    logs: t.optional(t.array(logEntrySchema)),
  }),
});

export type JobExecutionEntity = Static<typeof jobExecutions.schema>;
