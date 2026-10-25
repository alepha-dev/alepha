import { z } from "alepha";

import { automationAffectedRuleSchema } from "./automationAffectedRuleSchema.ts";
import { automationVariableResourceSchema } from "./automationVariableResourceSchema.ts";

export const automationVariableSetResponseSchema = z
  .object({
    variable: automationVariableResourceSchema,
    affected: z.array(automationAffectedRuleSchema).max(50),
    affectedCount: z.integer().nonnegative(),
    affectedHasMore: z.boolean(),
  })
  .strict();
