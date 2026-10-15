import { type Infer, z } from "alepha";

import { automationDescriptorSchema } from "./automationDescriptorSchema.ts";

export const automationPresetDescriptorSchema = automationDescriptorSchema
  .pick({
    key: true,
    slots: true,
    permissions: true,
    needs: true,
    fields: true,
  })
  .extend({
    title: z.string().min(1).max(255),
    description: z.string().max(2000),
    source: z.string().max(128),
    schedule: z.string().max(128).optional(),
  })
  .strict();
export type AutomationPresetDescriptor = Infer<
  typeof automationPresetDescriptorSchema
>;
