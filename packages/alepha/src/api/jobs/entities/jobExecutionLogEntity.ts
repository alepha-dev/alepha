import { type Static, t } from "alepha";
import { logEntrySchema } from "alepha/logger";
import { $entity, db } from "alepha/orm";

export const jobExecutionLogEntity = $entity({
  name: "job_execution_logs",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    logs: t.array(logEntrySchema),
  }),
});

export type JobExecutionLogEntity = Static<typeof jobExecutionLogEntity.schema>;
