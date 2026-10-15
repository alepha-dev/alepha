import { z } from "alepha";

import { automationDescriptorSchema } from "./automationDescriptorSchema.ts";

export const automationCatalogEntrySchema = automationDescriptorSchema.extend({
  available: z.boolean(),
  reason: z.string().optional(),
});
