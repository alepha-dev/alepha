import { z } from "alepha";

import { automationWriteBodySchema } from "../../api/schemas/automationWriteBodySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationCreateParamsSchema = projectParamsSchema
  .extend({
    ...automationWriteBodySchema.shape,
    enabled: z.boolean().default(false),
  })
  .strict();
