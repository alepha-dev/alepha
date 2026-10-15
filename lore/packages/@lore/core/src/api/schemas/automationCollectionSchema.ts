import { type Infer, z } from "alepha";

import { automationSafeFieldsSchema } from "./automationSafeFieldsSchema.ts";

export const automationCollectionSchema = z
  .object({
    items: z.array(automationSafeFieldsSchema).max(50),
    total: z.integer().nonnegative(),
    totalIsExact: z.boolean(),
    hasMore: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();

export type AutomationCollection = Infer<typeof automationCollectionSchema>;
