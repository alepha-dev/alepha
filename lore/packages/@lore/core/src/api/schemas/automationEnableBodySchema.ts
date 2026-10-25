import { z } from "alepha";

export const automationEnableBodySchema = z
  .object({ expectedRevision: z.integer().nonnegative(), enabled: z.boolean() })
  .strict();
