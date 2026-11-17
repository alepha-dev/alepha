import { z } from "alepha";

import { automationTestSourceSchema } from "../../api/schemas/automationTestSourceSchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationTestParamsSchema = projectParamsSchema
  .extend({
    id: z.uuid(),
    source: automationTestSourceSchema.optional(),
    node: z
      .string()
      .max(64)
      .describe(
        "The source node to start from, required when the automation has several.",
      )
      .optional(),
  })
  .strict();
