import { type Static, z } from "alepha";
import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts";

/**
 * Public-facing schema for a job execution row.
 *
 * Diverges from the raw entity in two places, both for API ergonomics:
 *
 * - `priority` is exposed as the **string enum** (`critical`/`high`/...)
 *   instead of the numeric value used internally for SQL ordering. The
 *   `JobService` is responsible for the int → string transform.
 * - `can` derives the available admin actions from the row's status.
 */
export const jobExecutionResourceSchema = jobExecutionEntity.schema
  .omit({ priority: true })
  .extend({
    priority: z.enum(["critical", "high", "normal", "low"]),
    can: z.object({
      retry: z.boolean(),
      cancel: z.boolean(),
    }),
  })
  .meta({
    title: "JobExecutionResource",
    description: "A job execution row with derived actions.",
  });

export type JobExecutionResource = Static<typeof jobExecutionResourceSchema>;
