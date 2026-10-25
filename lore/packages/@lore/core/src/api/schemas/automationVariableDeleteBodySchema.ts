import { z } from "alepha";

export const automationVariableDeleteBodySchema = z
  .object({ id: z.uuid(), version: z.integer().nonnegative() })
  .strict();
