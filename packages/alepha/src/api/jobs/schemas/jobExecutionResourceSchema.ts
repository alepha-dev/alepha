import { type Static, t } from "alepha";
import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts";

export const jobExecutionCanSchema = t.object({
  retry: t.boolean(),
  cancel: t.boolean(),
});

export const jobExecutionResourceSchema = t.extend(
  jobExecutionEntity.schema,
  {
    can: jobExecutionCanSchema,
  },
  {
    title: "JobExecutionResource",
    description: "A job execution resource.",
  },
);

export type JobExecutionResource = Static<typeof jobExecutionResourceSchema>;
