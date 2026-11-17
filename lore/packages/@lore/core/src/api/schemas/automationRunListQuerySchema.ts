import type { Infer } from "alepha";

import { automationGraphNodeIdSchema } from "./automationGraphNodeIdSchema.ts";
import { automationPageQuerySchema } from "./automationPageQuerySchema.ts";

/**
 * A page of an automation's runs, optionally those one source started
 * (#Q3807).
 */
export const automationRunListQuerySchema = automationPageQuerySchema
  .extend({ source: automationGraphNodeIdSchema.optional() })
  .strict();
export type AutomationRunListQuery = Infer<typeof automationRunListQuerySchema>;
