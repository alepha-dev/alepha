import { z } from "alepha";

import { automationValueSchema } from "./automationValueSchema.ts";

export const automationFilterValueSchema = z.union([
  automationValueSchema,
  z.array(automationValueSchema).max(50),
]);
