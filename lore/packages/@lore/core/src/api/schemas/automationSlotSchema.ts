import { type Infer, z } from "alepha";

import { automationFilterValueSchema } from "./automationFilterValueSchema.ts";
import { automationSlotKindSchema } from "./automationSlotKindSchema.ts";

export const automationSlotSchema = z
  .object({
    kind: automationSlotKindSchema,
    required: z.boolean(),
    template: z.boolean().optional(),
    bindable: z.boolean().optional(),
    resource: z.enum(["app", "quest", "area"]).optional(),
    values: z.array(automationFilterValueSchema).max(32).optional(),
    default: automationFilterValueSchema.optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict();
export type AutomationSlot = Infer<typeof automationSlotSchema>;
