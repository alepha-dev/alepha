import { z } from "alepha";

export const automationVariableParamsSchema = z
  .object({
    projectId: z.integer(),
    key: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
      .max(64),
  })
  .strict();
