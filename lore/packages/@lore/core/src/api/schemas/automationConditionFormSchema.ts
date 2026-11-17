import { z } from "alepha";

import { automationGuardSchema } from "./automationGuardSchema.ts";

/**
 * A condition node's inspector (#Q3811): the field it compares and how;
 * the value is its own control, literal or bound.
 */
export const automationConditionFormSchema = z.object({
  field: z.string().max(64).optional(),
  operator: automationGuardSchema.shape.operator,
});
