import { z } from "alepha";

import { automationAffectedRuleSchema } from "./automationAffectedRuleSchema.ts";

export const automationDependentPageSchema = z
  .object({
    items: z
      .array(automationAffectedRuleSchema.omit({ requiresApproval: true }))
      .max(50),
    hasMore: z.boolean(),
  })
  .strict();
