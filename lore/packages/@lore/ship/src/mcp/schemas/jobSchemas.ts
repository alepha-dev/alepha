import {
  HOST_JOB_STATUSES,
  projectParamsSchema,
  hostJobResourceSchema,
} from "@lore/core/schemas";
import { z } from "alepha";

// -----------------------------------------------------------------------------
// job_list
// -----------------------------------------------------------------------------

export const jobListParamsSchema = projectParamsSchema.extend({
  status: z
    .enum(HOST_JOB_STATUSES)
    .optional()
    .describe("Only the jobs in this status."),
  limit: z
    .integer()
    .min(1)
    .max(500)
    .optional()
    .describe("How many jobs, newest first. Defaults to 50."),
});

export const jobListResultSchema = z.object({
  jobs: z.array(hostJobResourceSchema.omit({ input: true })),
});

// -----------------------------------------------------------------------------
// job_get, job_cancel
// -----------------------------------------------------------------------------

export const jobIdParamsSchema = z.object({
  id: z.uuid().describe("The job's id, from job_list."),
});

export const jobGetParamsSchema = jobIdParamsSchema.extend({
  log: z
    .boolean()
    .optional()
    .describe("Also return the job's log, both streams, as far as it has run."),
});

export const jobGetResultSchema = hostJobResourceSchema.extend({
  stdout: z.string().optional(),
  stderr: z.string().optional(),
});
