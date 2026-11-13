import { type Infer, z } from "alepha";

import { automationWriteBodySchema } from "./automationWriteBodySchema.ts";

/**
 * A new rule, and whether it is created enabled (#Q3573).
 *
 * `enabled: true` is one atomic write: the rule is inserted enabled, after
 * the checks the Enable action runs, or not at all. Absent or false, it is a
 * draft, as every rule used to be.
 */
export const automationCreateBodySchema = automationWriteBodySchema
  .extend({ enabled: z.boolean().optional() })
  .strict();
export type AutomationCreateBody = Infer<typeof automationCreateBodySchema>;
