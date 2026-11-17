import { type Infer, z } from "alepha";

import { automationGraphSchema } from "./automationGraphSchema.ts";

export const automationWriteBodySchema = z
  .object({ title: z.string().min(1).max(255), rule: automationGraphSchema })
  .strict();
export type AutomationWriteBody = Infer<typeof automationWriteBodySchema>;
