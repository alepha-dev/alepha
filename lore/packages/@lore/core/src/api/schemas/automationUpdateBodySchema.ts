import { z } from "alepha";

import { automationWriteBodySchema } from "./automationWriteBodySchema.ts";

export const automationUpdateBodySchema = automationWriteBodySchema
  .extend({ expectedRevision: z.integer().nonnegative() })
  .strict();
