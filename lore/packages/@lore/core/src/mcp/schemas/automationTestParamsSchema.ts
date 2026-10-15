import { z } from "alepha";

import { automationTestSourceSchema } from "../../api/schemas/automationTestSourceSchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationTestParamsSchema = projectParamsSchema
  .extend({
    id: z.uuid(),
    source: automationTestSourceSchema.optional(),
  })
  .strict();
