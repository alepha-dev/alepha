import { type Infer, z } from "alepha";

import { automationCompactSchema } from "./automationCompactSchema.ts";
import { automationGraphSchema } from "./automationGraphSchema.ts";

/**
 * An automation as a client writes it: the whole graph as `rule`, or the
 * compact `sources` + `actions` (#Q3809), which the server expands; one
 * of the two (`AutomationService.authored` refuses both or neither).
 */
export const automationWriteBodySchema = z
  .object({
    title: z.string().min(1).max(255),
    rule: automationGraphSchema.optional(),
    sources: automationCompactSchema.shape.sources.optional(),
    actions: automationCompactSchema.shape.actions.optional(),
  })
  .strict();
export type AutomationWriteBody = Infer<typeof automationWriteBodySchema>;
