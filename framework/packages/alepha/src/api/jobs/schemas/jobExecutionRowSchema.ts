import type { Infer } from "alepha";

import { jobExecutionResourceSchema } from "./jobExecutionResourceSchema.ts";

/**
 * One row of a job's executions page: the resource without `payload`,
 * `logs`, `steps` and `result`, which the database does not even load for a list. Read
 * a single execution for them.
 */
export const jobExecutionRowSchema = jobExecutionResourceSchema
  .omit({ payload: true, logs: true, steps: true, result: true })
  .meta({
    title: "JobExecutionRow",
    description:
      "A job execution in a list, without its payload, captured logs, steps and result.",
  });

export type JobExecutionRow = Infer<typeof jobExecutionRowSchema>;
