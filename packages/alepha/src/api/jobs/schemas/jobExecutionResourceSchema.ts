import { type Static, t } from "alepha";
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
export const jobExecutionResourceSchema = t.extend(
  jobExecutionEntity.schema,
  {
    priority: t.enum(["critical", "high", "normal", "low"]),
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
