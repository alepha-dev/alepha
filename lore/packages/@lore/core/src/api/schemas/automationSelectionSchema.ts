import { z } from "alepha";

import { automationValueSchema } from "./automationValueSchema.ts";

/**
 * Registered selector names and filters are validated against the live catalogue.
 */
export const automationSelectionSchema = z
  .object({
    kind: z.enum(["rows", "scalar", "collection"]),
    key: z.string().min(1).max(128),
    filters: z
      .record(z.string().max(64), automationValueSchema)
      .refine((value) => Object.keys(value).length <= 16),
  })
  .strict();
