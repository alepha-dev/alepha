import { type Infer, z } from "alepha";

import { automationGuardSchema } from "./automationGuardSchema.ts";
import { automationRequirementSchema } from "./automationRequirementSchema.ts";
import { automationSlotKindSchema } from "./automationSlotKindSchema.ts";
import { automationSlotSchema } from "./automationSlotSchema.ts";

export const automationDescriptorSchema = z
  .object({
    key: z.string().min(1).max(128),
    type: z.enum(["event", "selection", "metric", "action"]),
    result: z.enum(["event", "rows", "scalar", "collection", "effect"]),
    fields: z.record(z.string().max(64), automationSlotKindSchema),
    itemFields: z
      .record(z.string().max(64), automationSlotKindSchema)
      .optional(),
    slots: z.record(z.string().max(64), automationSlotSchema),
    permissions: z.array(z.string().max(64)).max(8),
    needs: z.array(automationRequirementSchema).max(4),
    operators: z.array(automationGuardSchema.shape.operator).max(8),
  })
  .strict();
export type AutomationDescriptor = Infer<typeof automationDescriptorSchema>;
