import { z } from "alepha";

import { automationVariableResourceSchema } from "./automationVariableResourceSchema.ts";

export const automationVariablePageSchema = z
  .object({
    items: z.array(automationVariableResourceSchema).max(50),
    hasMore: z.boolean(),
    nextOffset: z.integer().nonnegative().optional(),
  })
  .strict();
