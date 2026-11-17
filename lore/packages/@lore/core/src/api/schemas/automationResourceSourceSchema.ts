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
    /**
     * What it does in one line (#Q3809): `host.offline -> notify inbox`.
     */
    summary: z.string().max(255).optional(),
    /**
     * A schedule's cron expression, so a list names it without the graph
     * (#Q3810).
     */
    cron: z.string().max(255).optional(),
  })
  .strict();
export type AutomationResourceSource = Infer<
  typeof automationResourceSourceSchema
>;
