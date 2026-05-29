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
  // `t.extend` composes (interface-extends), it does not override: the base
  // `priority` (integer) would still be enforced alongside the enum below and
  // reject the int→string transform. Drop it from the base first.
  t.omit(jobExecutionEntity.schema, ["priority"]),
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
