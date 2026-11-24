import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * A project's two alert thresholds (#Q3894): line coverage on `main` (Build's
 * Quality), and open errors (Ship's Errors), both set in Ship's settings. In
 * core since #E162, so both pillars read it.
 *
 * A row of its own, keyed by the project: `project_capabilities.options`
 * holds switches only, and a column on `projects` is a parent table the
 * migrations never rebuild. Every column is optional with no database
 * default, so adding one later is a plain `ADD COLUMN`.
 *
 * **Edge-triggered.** An alert fires when its value crosses the threshold,
 * not while it stays on the wrong side: `*Armed` is flipped to false by the
 * conditional write that records the event, and back to true when the value
 * returns. Absent reads as armed.
 */
export const projectThresholds = $entity({
  name: "project_thresholds",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    coverageMin: z.number().min(0).max(100).optional(),
    coverageArmed: z.boolean().optional(),
    openErrorsMax: z.integer().min(0).optional(),
    errorsArmed: z.boolean().optional(),
  }),
  indexes: [{ columns: ["projectId"], unique: true }],
});

export type ProjectThreshold = Infer<typeof projectThresholds.schema>;
