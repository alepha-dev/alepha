import { type Infer, z } from "alepha";

import { automationDescriptorSchema } from "./automationDescriptorSchema.ts";
import { automationGraphEdgeSchema } from "./automationGraphEdgeSchema.ts";
import { AutomationVocabulary } from "./AutomationVocabulary.ts";

/**
 * One node type a graph may hold (#Q3805): its kind, the ports it leaves
 * by, the fields it brings to the nodes after it (a source or a read), its
 * slots, the outputs it gives the actions after it, and whether this author
 * may use it in this project.
 */
export const automationCatalogNodeTypeSchema = z
  .object({
    type: z.string().max(128),
    kind: z.enum(AutomationVocabulary.KINDS),
    ports: z.array(automationGraphEdgeSchema.shape.port).max(2),
    fields: automationDescriptorSchema.shape.fields,
    slots: automationDescriptorSchema.shape.slots,
    outputs: automationDescriptorSchema.shape.outputs,
    available: z.boolean(),
    reason: z.string().optional(),
  })
  .strict();
export type AutomationCatalogNodeType = Infer<
  typeof automationCatalogNodeTypeSchema
>;
