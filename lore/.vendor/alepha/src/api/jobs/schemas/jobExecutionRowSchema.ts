import type { Infer } from "alepha";

import { jobExecutionResourceSchema } from "./jobExecutionResourceSchema.ts";

/**
 * One row of a job's executions page: the resource without `payload` and
 * `logs`, which the database does not even load for a list. Read a single
 * execution for both.
 */
export const jobExecutionRowSchema = jobExecutionResourceSchema
  .omit({ payload: true, logs: true })
  .meta({
    title: "JobExecutionRow",
    description:
      "A job execution in a list, without its payload and captured logs.",
  });

export type JobExecutionRow = Infer<typeof jobExecutionRowSchema>;
