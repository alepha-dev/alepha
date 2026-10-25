import { z } from "alepha";

import { automationAdoptionPolicySchema } from "./automationAdoptionPolicySchema.ts";

export const automationAdoptionParamsSchema = z.object({
  projectId: z.integer(),
  policy: automationAdoptionPolicySchema,
});
