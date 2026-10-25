import { z } from "alepha";

import { automationPresetDescriptorSchema } from "./automationPresetDescriptorSchema.ts";

export const automationCatalogPresetSchema =
  automationPresetDescriptorSchema.extend({
    available: z.boolean(),
    reason: z.string().optional(),
  });
