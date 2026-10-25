import { type Infer, z } from "alepha";

import { automationRuleSchema } from "./automationRuleSchema.ts";

export const automationWriteBodySchema = z
  .object({ title: z.string().min(1).max(255), rule: automationRuleSchema })
  .strict();
export type AutomationWriteBody = Infer<typeof automationWriteBodySchema>;
