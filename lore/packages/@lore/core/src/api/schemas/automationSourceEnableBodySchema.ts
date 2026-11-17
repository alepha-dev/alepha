import { z } from "alepha";

import { automationGraphNodeIdSchema } from "./automationGraphNodeIdSchema.ts";

/**
 * Switch one source of an automation off or on (#Q3806), against the
 * revision the caller read.
 */
export const automationSourceEnableBodySchema = z
  .object({
    node: automationGraphNodeIdSchema,
    enabled: z.boolean(),
    expectedRevision: z.integer().nonnegative(),
  })
  .strict();
