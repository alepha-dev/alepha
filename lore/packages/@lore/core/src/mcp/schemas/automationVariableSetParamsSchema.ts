import { z } from "alepha";

import { automationVariableSetBodySchema } from "../../api/schemas/automationVariableSetBodySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationVariableSetParamsSchema = projectParamsSchema
  .extend({
    key: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
      .max(64),
    variable: automationVariableSetBodySchema,
  })
  .strict();
