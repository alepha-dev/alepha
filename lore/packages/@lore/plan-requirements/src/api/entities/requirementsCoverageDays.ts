import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * One row per project, day and scope (#E153, #Q3775): how many
 * requirements were verified and covered out of all that day, for the
 * Coverage over time card. `scope` is `all`, or `release:<id>` for each
 * release holding at least one requirement. Written by a daily job; history
 * starts the day the `requirements` option is on, nothing is backfilled.
 */
export const requirementsCoverageDays = $entity({
  name: "requirements_coverage_days",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * `YYYY-MM-DD`, UTC.
     */
    day: z.string().max(10),
    scope: z.string().max(40),
    verified: z.integer().min(0),
    covered: z.integer().min(0),
    total: z.integer().min(0),
  }),
  indexes: [{ columns: ["projectId", "scope", "day"], unique: true }],
});

export type RequirementsCoverageDay = Infer<
  typeof requirementsCoverageDays.schema
>;
