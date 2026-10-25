import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationGetParamsSchema = projectParamsSchema
  .extend({
    id: z.uuid(),
  })
  .strict();
