import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationDeleteParamsSchema = projectParamsSchema
  .extend({
    id: z.uuid(),
    expectedRevision: z.integer().nonnegative(),
  })
  .strict();
