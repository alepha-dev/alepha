import { z } from "alepha";

import { automationResourceSchema } from "./automationResourceSchema.ts";

export const automationPageSchema = z
  .object({
    items: z.array(automationResourceSchema).max(50),
    hasMore: z.boolean(),
    nextOffset: z.integer().nonnegative().optional(),
  })
  .strict();
