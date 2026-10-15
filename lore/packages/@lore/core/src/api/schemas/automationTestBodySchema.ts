import { z } from "alepha";

import { automationTestSourceSchema } from "./automationTestSourceSchema.ts";

export const automationTestBodySchema = z
  .object({ source: automationTestSourceSchema.optional() })
  .strict();
