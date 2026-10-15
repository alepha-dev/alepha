import { z } from "alepha";

import { automationPageQuerySchema } from "../../api/schemas/automationPageQuerySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationRunsParamsSchema = projectParamsSchema
  .extend({
    ...automationPageQuerySchema.shape,
    id: z
      .uuid()
      .describe(
        "Automation ID, including a soft-deleted rule with retained history",
      ),
  })
  .strict();
