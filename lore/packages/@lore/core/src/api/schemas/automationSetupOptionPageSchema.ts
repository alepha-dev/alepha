import { z } from "alepha";

export const automationSetupOptionPageSchema = z
  .object({
    items: z
      .array(
        z
          .object({ value: z.string().max(255), label: z.string().max(255) })
          .strict(),
      )
      .max(50),
    hasMore: z.boolean(),
    nextOffset: z.integer().nonnegative().optional(),
  })
  .strict();
