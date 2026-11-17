import { type Infer, z } from "alepha";

import { automationGraphSchema } from "./automationGraphSchema.ts";

/**
 * A preset's graph, built and checked but not stored (#Q3812): what the
 * editor opens, or adds to its draft.
 */
export const automationPresetDraftSchema = z
  .object({
    title: z.string().min(1).max(255),
    rule: automationGraphSchema,
  })
  .strict();
export type AutomationPresetDraft = Infer<typeof automationPresetDraftSchema>;
