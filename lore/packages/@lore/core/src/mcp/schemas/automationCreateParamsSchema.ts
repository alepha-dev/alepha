import { z } from "alepha";

import { automationWriteBodySchema } from "../../api/schemas/automationWriteBodySchema.ts";
import { AutomationGraphParams } from "./AutomationGraphParams.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationCreateParamsSchema = projectParamsSchema
  .extend({
    title: automationWriteBodySchema.shape.title,
    ...AutomationGraphParams.SHAPE,
    enabled: z.boolean().default(false),
  })
  .strict();
