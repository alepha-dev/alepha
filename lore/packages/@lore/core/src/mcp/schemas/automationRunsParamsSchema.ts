import { z } from "alepha";

import { automationPageQuerySchema } from "../../api/schemas/automationPageQuerySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationRunsParamsSchema = projectParamsSchema
  .extend({
    ...automationPageQuerySchema.shape,
    source: z
      .string()
      .max(64)
      .describe("Only the runs this source node started.")
      .optional(),
    id: z
      .uuid()
      .describe(
        "Automation ID, including a soft-deleted rule with retained history",
      ),
  })
  .strict();
