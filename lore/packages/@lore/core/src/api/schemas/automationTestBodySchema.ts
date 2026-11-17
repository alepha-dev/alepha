import { z } from "alepha";

import { automationGraphNodeIdSchema } from "./automationGraphNodeIdSchema.ts";
import { automationTestSourceSchema } from "./automationTestSourceSchema.ts";

export const automationTestBodySchema = z
  .object({
    source: automationTestSourceSchema.optional(),
    /**
     * The source to start from (#Q3807), required when the automation has
     * several.
     */
    node: automationGraphNodeIdSchema.optional(),
  })
  .strict();
