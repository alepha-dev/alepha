import type { Infer } from "alepha";

import { jobExecutionResourceSchema } from "./jobExecutionResourceSchema.ts";

/**
 * One row of a job's executions page: the resource without `payload`,
 * `logs` and `steps`, which the database does not even load for a list. Read
 * a single execution for them.
 */
export const jobExecutionRowSchema = jobExecutionResourceSchema
  .omit({ payload: true, logs: true, steps: true })
  .meta({
    title: "JobExecutionRow",
    description:
      "A job execution in a list, without its payload, captured logs and steps.",
  });

export type JobExecutionRow = Infer<typeof jobExecutionRowSchema>;
