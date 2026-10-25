import { z } from "alepha";

import { automationRunResourceSchema } from "./automationRunResourceSchema.ts";

export const automationRunPageSchema = z
  .object({
    items: z.array(automationRunResourceSchema).max(50),
    hasMore: z.boolean(),
    nextOffset: z.integer().nonnegative().optional(),
  })
  .strict();
