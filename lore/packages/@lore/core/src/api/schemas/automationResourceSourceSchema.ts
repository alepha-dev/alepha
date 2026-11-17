import { type Infer, z } from "alepha";

import { automationGraphNodeIdSchema } from "./automationGraphNodeIdSchema.ts";

/**
 * One source of an automation as its page and its list show it (#Q3806):
 * what starts it, its own switch, and its own health.
 */
export const automationResourceSourceSchema = z
  .object({
    node: automationGraphNodeIdSchema,
    type: z.string().max(128),
    enabled: z.boolean(),
    health: z.enum(["active", "broken"]),
    reason: z.string().max(1024).optional(),
  })
  .strict();
export type AutomationResourceSource = Infer<
  typeof automationResourceSourceSchema
>;
