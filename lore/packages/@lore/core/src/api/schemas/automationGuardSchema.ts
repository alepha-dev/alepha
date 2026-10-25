import { z } from "alepha";

import { automationValueSchema } from "./automationValueSchema.ts";

export const automationGuardSchema = z
  .object({
    field: z.string().min(1).max(128),
    operator: z.enum([
      "eq",
      "ne",
      "lt",
      "lte",
      "gt",
      "gte",
      "delta",
      "crossesAbove",
    ]),
    value: automationValueSchema,
  })
  .strict();
