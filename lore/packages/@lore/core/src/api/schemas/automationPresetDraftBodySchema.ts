import { automationGraphNodeIdSchema } from "./automationGraphNodeIdSchema.ts";
import { automationPresetCreateSchema } from "./automationPresetCreateSchema.ts";

/**
 * A preset built as a draft, saved nowhere (#Q3812): its values and
 * bindings as the create takes them, and, to add it to a graph being
 * edited, the prefix its node ids take (`<key>` or `<key>-2`).
 */
export const automationPresetDraftBodySchema = automationPresetCreateSchema
  .omit({ enabled: true })
  .extend({
    prefix: automationGraphNodeIdSchema.optional(),
  })
  .strict();
