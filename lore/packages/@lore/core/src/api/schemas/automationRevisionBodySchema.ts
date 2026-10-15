import { z } from "alepha";

export const automationRevisionBodySchema = z
  .object({ expectedRevision: z.integer().nonnegative() })
  .strict();
