import { z } from "alepha";

import { automationSourceEnableBodySchema } from "../../api/schemas/automationSourceEnableBodySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationSourceSetParamsSchema = projectParamsSchema
  .extend({
    id: z.uuid(),
    ...automationSourceEnableBodySchema.shape,
  })
  .strict();
