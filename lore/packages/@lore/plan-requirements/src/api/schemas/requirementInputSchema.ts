import { type Infer } from "alepha";

import { requirements } from "../entities/requirements.ts";

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
    sourceRevisionId: true,
  })
  .partial();

export type RequirementInput = Infer<typeof requirementInputSchema>;
