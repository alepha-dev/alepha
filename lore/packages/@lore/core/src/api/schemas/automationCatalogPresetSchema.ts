import { z } from "alepha";

import { automationPresetDescriptorSchema } from "./automationPresetDescriptorSchema.ts";
import { automationPresetSketchSchema } from "./automationPresetSketchSchema.ts";

export const automationCatalogPresetSchema =
  automationPresetDescriptorSchema.extend({
    available: z.boolean(),
    reason: z.string().optional(),
    /**
     * Its graph's shape, for the card's drawing (#Q3812); absent when the
     * preset cannot be built without its inputs.
     */
    sketch: automationPresetSketchSchema.optional(),
  });
