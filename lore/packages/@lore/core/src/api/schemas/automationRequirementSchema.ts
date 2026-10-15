import { z } from "alepha";

import { capabilityKeySchema } from "./capabilityKeySchema.ts";

export const automationRequirementSchema = z
  .object({
    capability: capabilityKeySchema,
    option: z.string().max(64).optional(),
  })
  .strict();
