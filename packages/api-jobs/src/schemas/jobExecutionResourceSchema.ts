import { type Static, t } from "@alepha/core";
import { jobExecutions } from "../entities/jobExecutions.ts";

export const jobExecutionResourceSchema = t.interface(
  [jobExecutions.$schema],
  {},
  {
    title: "JobExecutionResource",
    description:
      "A job execution resource representing the execution details of a job.",
  },
);

export type JobExecutionResource = Static<typeof jobExecutionResourceSchema>;
