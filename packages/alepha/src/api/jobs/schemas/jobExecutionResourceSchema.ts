import { type Static, t } from "alepha";
import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts";

export const jobExecutionResourceSchema = t.extend(
  jobExecutionEntity.schema,
  {
    can: t.object({
      retry: t.boolean(),
      cancel: t.boolean(),
    }),
  },
  {
    title: "JobExecutionResource",
    description: "A job execution row with derived actions.",
  },
);

export type JobExecutionResource = Static<typeof jobExecutionResourceSchema>;
