import { z } from "alepha";

import { automationPageQuerySchema } from "../../api/schemas/automationPageQuerySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationVariableDependentsParamsSchema = projectParamsSchema
  .extend({
    ...automationPageQuerySchema.shape,
    key: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
      .max(64),
  })
  .strict();
