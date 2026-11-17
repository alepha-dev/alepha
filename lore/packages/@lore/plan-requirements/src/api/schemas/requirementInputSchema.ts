import { type Infer } from "alepha";

import { requirements } from "../entities/requirements.ts";
import { requirementMetricSchema } from "./requirementMetricSchema.ts";

/**
 * What a create or an update writes on a requirement (#E153). The target
 * release is not here: `setRequirementRelease` owns it, because setting it
 * may move epics.
 */
export const requirementInputSchema = requirements.schema
  .pick({
    statement: true,
    description: true,
    type: true,
    priority: true,
    chapter: true,
    paragraph: true,
    sourceFolioId: true,
    sourceAnchor: true,
  })
  .partial()
  .extend({
    /**
     * The measure verifying it (#Q3773); `null` clears it.
     */
    metric: requirementMetricSchema.nullable().optional(),
  });

export type RequirementInput = Infer<typeof requirementInputSchema>;
