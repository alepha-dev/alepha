import { z } from "alepha";

export const automationAffectedRuleSchema = z
  .object({
    id: z.uuid(),
    title: z.string().max(255),
    authorUserId: z.uuid(),
    requiresApproval: z.boolean(),
  })
  .strict();
