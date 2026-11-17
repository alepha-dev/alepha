import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { metricStatusSchema } from "../schemas/requirementMetricSchema.ts";
import { requirements } from "./requirements.ts";

/**
 * One row per metric requirement and day (#E153, #Q3773): the day's last
 * evaluated value, the 14-day sparkline of the detail pane.
 */
export const requirementMetricDays = $entity({
  name: "requirement_metric_days",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    requirementId: db.ref(z.integer(), () => requirements.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * `YYYY-MM-DD`, UTC.
     */
    day: z.string().max(10),
    value: z.number().optional(),
    status: metricStatusSchema.meta({ mode: "text" }),
  }),
  indexes: [{ columns: ["requirementId", "day"], unique: true }],
});

export type RequirementMetricDay = Infer<typeof requirementMetricDays.schema>;
