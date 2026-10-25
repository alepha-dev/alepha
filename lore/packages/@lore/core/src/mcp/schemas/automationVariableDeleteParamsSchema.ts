import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationVariableDeleteParamsSchema = projectParamsSchema
  .extend({
    key: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
      .max(64),
    id: z.uuid(),
    version: z.integer().nonnegative(),
  })
  .strict();
