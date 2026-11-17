import { type Infer, z } from "alepha";

import { automationValueSchema } from "./automationValueSchema.ts";

export const automationFilterValueSchema = z.union([
  automationValueSchema,
  z.array(automationValueSchema).max(50),
]);
export type AutomationFilterValue = Infer<typeof automationFilterValueSchema>;
