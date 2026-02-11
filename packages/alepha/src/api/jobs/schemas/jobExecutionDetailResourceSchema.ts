import { type Static, t } from "alepha";
import { logEntrySchema } from "alepha/logger";
import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts";
import { jobExecutionCanSchema } from "./jobExecutionResourceSchema.ts";

export const jobExecutionDetailResourceSchema = t.extend(
  jobExecutionEntity.schema,
  {
    can: jobExecutionCanSchema,
    logs: t.optional(t.array(logEntrySchema)),
  },
  {
    title: "JobExecutionDetailResource",
    description: "A job execution resource with logs.",
  },
);

export type JobExecutionDetailResource = Static<
  typeof jobExecutionDetailResourceSchema
>;
